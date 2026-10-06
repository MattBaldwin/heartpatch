import { ItemCountsSchema, type ItemCounts } from '@heartpatch/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { gatherJobs, tiles } from '../../db/schema.js';
import { firstCaptureSince } from '../jobs/repo.js';

/** A tile as gathering needs it (read only: tiles belong to the maps module). */
export interface NodeTileRow {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  nodeResource: string | null;
}

export type GatherStatus = (typeof gatherJobs.$inferSelect)['status'];

export interface GatherRow {
  id: string;
  mapId: string;
  userId: string;
  tileId: string;
  q: number;
  r: number;
  resource: string;
  items: ItemCounts;
  status: GatherStatus;
  startedAt: Date;
  readyAt: Date;
  endedAt: Date | null;
}

export type NewGather = Omit<GatherRow, 'id' | 'q' | 'r' | 'status' | 'endedAt'>;

/** A gather as settling sees it: who holds its tile now, and when it first changed hands. */
export interface SettleGatherRow extends GatherRow {
  tileOwner: string | null;
  /** The first capture of its tile after the gather started, or null (`tile_attacks`). */
  lostAt: Date | null;
}

/**
 * Gather storage. Plain queries; the service decides the rules and runs each
 * command in one transaction. Map and membership reads go through the maps
 * repo (`createMapsRepo(tx)`) on the same transaction.
 */
export interface GatheringRepo {
  transaction: <T>(fn: (repo: GatheringTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /**
   * The tile at `q, r` on the map, share-locked until commit so its owner
   * can't change while a gather starts on it.
   */
  lockTileAt: (mapId: string, q: number, r: number) => Promise<NodeTileRow | null>;
  /** Who owns the tile now, share-locked until commit (as `lockTileAt`). */
  lockTileOwner: (tileId: string) => Promise<string | null>;
  /** The node's gather that is still going, whoever started it. */
  findActiveOnTile: (tileId: string) => Promise<GatherRow | null>;
  insertGather: (gather: NewGather) => Promise<GatherRow>;
  /** The gather, unlocked (its tile never changes, so collect can lock that first). */
  findGather: (gatherId: string) => Promise<GatherRow | null>;
  /** Row-locks the gather until commit; collecting runs under it. */
  lockGather: (gatherId: string) => Promise<GatherRow | null>;
  /**
   * The player's gathers still going on tiles they own now, oldest first. A
   * gather left on land they've lost isn't theirs to collect.
   */
  listActive: (mapId: string, userId: string) => Promise<GatherRow[]>;
  /** Every gather of the player's still active on the map, wherever its tile went, in id order. Unlocked. */
  listToSettle: (mapId: string, userId: string) => Promise<SettleGatherRow[]>;
  /** Row-locks these gathers in id order until commit and reads them again. */
  lockToSettle: (gatherIds: readonly string[]) => Promise<SettleGatherRow[]>;
  /** Ends an active gather; false if it had already ended. */
  endGather: (
    gatherId: string,
    end: { status: Exclude<GatherStatus, 'active'>; at: Date },
  ) => Promise<boolean>;
  /**
   * Dev and test only: the player's gathers still going on this map become
   * ready at `at`, keeping each one's length (`started_at` moves back with
   * `ready_at`). Returns how many moved.
   */
  makeReady: (mapId: string, userId: string, at: Date) => Promise<number>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface GatheringTxRepo extends GatheringRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const gatherColumns = {
  id: gatherJobs.id,
  mapId: gatherJobs.mapId,
  userId: gatherJobs.userId,
  tileId: gatherJobs.tileId,
  q: tiles.q,
  r: tiles.r,
  resource: gatherJobs.resource,
  items: gatherJobs.items,
  status: gatherJobs.status,
  startedAt: gatherJobs.startedAt,
  readyAt: gatherJobs.readyAt,
  endedAt: gatherJobs.endedAt,
};

/** A gather as settling reads it: the tile's owner now, and the first capture since it started. */
const settleColumns = {
  ...gatherColumns,
  tileOwner: tiles.ownerUserId,
  lostAt: firstCaptureSince(gatherJobs.tileId, gatherJobs.startedAt),
};

const toGather = (row: Omit<GatherRow, 'items'> & { items: unknown }): GatherRow => ({
  ...row,
  // JSON is checked on read, so a hand-edited row fails loudly.
  items: ItemCountsSchema.parse(row.items),
});

export function createGatheringRepo(db: Executor): GatheringRepo {
  return queries(db);
}

function createGatheringTxRepo(tx: Transaction): GatheringTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): GatheringRepo {
  const selectGathers = () =>
    db.select(gatherColumns).from(gatherJobs).innerJoin(tiles, eq(tiles.id, gatherJobs.tileId));

  const selectToSettle = () =>
    db.select(settleColumns).from(gatherJobs).innerJoin(tiles, eq(tiles.id, gatherJobs.tileId));
  const toSettle = ({
    tileOwner,
    lostAt,
    ...row
  }: Awaited<ReturnType<typeof selectToSettle>>[number]) => ({
    ...toGather(row),
    tileOwner,
    lostAt,
  });

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createGatheringTxRepo(tx), tx)),

    lockTileAt: async (mapId, q, r) => {
      const [row] = await db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          ownerUserId: tiles.ownerUserId,
          nodeResource: tiles.nodeResource,
        })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)))
        .for('share');
      return row ?? null;
    },

    lockTileOwner: async (tileId) => {
      const [row] = await db
        .select({ ownerUserId: tiles.ownerUserId })
        .from(tiles)
        .where(eq(tiles.id, tileId))
        .for('share');
      return row?.ownerUserId ?? null;
    },

    findActiveOnTile: async (tileId) => {
      const [row] = await selectGathers().where(
        and(eq(gatherJobs.tileId, tileId), eq(gatherJobs.status, 'active')),
      );
      return row ? toGather(row) : null;
    },

    insertGather: async (gather) => {
      const [row] = await db
        .insert(gatherJobs)
        .values({ ...gather, status: 'active' })
        .returning({ id: gatherJobs.id });
      if (!row) throw new Error('insertGather: insert returned no row');
      const [inserted] = await selectGathers().where(eq(gatherJobs.id, row.id));
      if (!inserted) throw new Error('insertGather: gather vanished');
      return toGather(inserted);
    },

    findGather: async (gatherId) => {
      const [row] = await selectGathers().where(eq(gatherJobs.id, gatherId));
      return row ? toGather(row) : null;
    },

    lockGather: async (gatherId) => {
      const [row] = await selectGathers()
        .where(eq(gatherJobs.id, gatherId))
        .for('update', { of: gatherJobs });
      return row ? toGather(row) : null;
    },

    listActive: async (mapId, userId) =>
      (
        await selectGathers()
          .where(
            and(
              eq(gatherJobs.mapId, mapId),
              eq(gatherJobs.userId, userId),
              eq(gatherJobs.status, 'active'),
              eq(tiles.ownerUserId, userId),
            ),
          )
          .orderBy(asc(gatherJobs.startedAt), asc(gatherJobs.id))
      ).map(toGather),

    listToSettle: async (mapId, userId) =>
      (
        await selectToSettle()
          .where(
            and(
              eq(gatherJobs.mapId, mapId),
              eq(gatherJobs.userId, userId),
              eq(gatherJobs.status, 'active'),
            ),
          )
          .orderBy(asc(gatherJobs.id))
      ).map(toSettle),

    lockToSettle: async (gatherIds) => {
      if (gatherIds.length === 0) return [];
      // Rows of one kind lock in id order (tech spec §7).
      return (
        await selectToSettle()
          .where(inArray(gatherJobs.id, [...gatherIds]))
          .orderBy(asc(gatherJobs.id))
          .for('update', { of: gatherJobs })
      ).map(toSettle);
    },

    endGather: async (gatherId, end) => {
      // Only an active gather ends: one collected meanwhile stays collected.
      const ended = await db
        .update(gatherJobs)
        .set({ status: end.status, endedAt: end.at })
        .where(and(eq(gatherJobs.id, gatherId), eq(gatherJobs.status, 'active')))
        .returning({ id: gatherJobs.id });
      return ended.length > 0;
    },

    makeReady: async (mapId, userId, at) => {
      const mine = and(
        eq(gatherJobs.mapId, mapId),
        eq(gatherJobs.userId, userId),
        eq(gatherJobs.status, 'active'),
        gt(gatherJobs.readyAt, at),
      );
      // Rows of one kind lock in id order (tech spec §7), before the update.
      const rows = await db
        .select({ id: gatherJobs.id })
        .from(gatherJobs)
        .where(mine)
        .orderBy(asc(gatherJobs.id))
        .for('update');
      if (rows.length === 0) return 0;
      const moved = await db
        .update(gatherJobs)
        .set({
          startedAt: sql`${gatherJobs.startedAt} - (${gatherJobs.readyAt} - ${at.toISOString()}::timestamptz)`,
          readyAt: at,
        })
        .where(mine)
        .returning({ id: gatherJobs.id });
      return moved.length;
    },
  };
}
