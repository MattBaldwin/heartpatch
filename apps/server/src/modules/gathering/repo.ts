import { ItemCountsSchema, type ItemCounts } from '@heartpatch/shared';
import { and, asc, eq } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { gatherJobs, tiles } from '../../db/schema.js';

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
  /** Row-locks the gather until commit; collecting runs under it. */
  lockGather: (gatherId: string) => Promise<GatherRow | null>;
  /**
   * The player's gathers still going on tiles they own now, oldest first. A
   * gather left on land they've lost isn't theirs to collect.
   */
  listActive: (mapId: string, userId: string) => Promise<GatherRow[]>;
  /** Ends an active gather; false if it had already ended. */
  endGather: (
    gatherId: string,
    end: { status: Exclude<GatherStatus, 'active'>; at: Date },
  ) => Promise<boolean>;
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

    endGather: async (gatherId, end) => {
      // Only an active gather ends: one collected meanwhile stays collected.
      const ended = await db
        .update(gatherJobs)
        .set({ status: end.status, endedAt: end.at })
        .where(and(eq(gatherJobs.id, gatherId), eq(gatherJobs.status, 'active')))
        .returning({ id: gatherJobs.id });
      return ended.length > 0;
    },
  };
}
