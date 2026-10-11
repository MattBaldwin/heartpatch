import { CLEARED_TERRAIN, ItemCountsSchema, type ItemCounts } from '@heartpatch/shared';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { buildings, squishies, tileClears, tileDefenders, tiles } from '../../db/schema.js';
import { firstCaptureSince } from '../jobs/repo.js';

/** A tile as a clear needs it (tiles belong to the maps module; only a finished clear writes one). */
export interface ClearTileRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  nodeResource: string | null;
  homeSlot: number | null;
}

export type ClearEndReason = 'cleared' | 'lost';

export interface ClearRow {
  id: string;
  mapId: string;
  userId: string;
  tileId: string;
  q: number;
  r: number;
  fromTerrain: string;
  fromNode: string | null;
  tool: string;
  drop: ItemCounts;
  startedAt: Date;
  readyAt: Date;
  endedAt: Date | null;
  endReason: ClearEndReason | null;
}

export type NewClear = Omit<ClearRow, 'id' | 'q' | 'r' | 'endedAt' | 'endReason'>;

/** A clear as settling sees it: who holds its tile now, and when it first changed hands. */
export interface SettleClearRow extends ClearRow {
  tileOwner: string | null;
  /** The first capture (or going wild) of its tile after the clear started, or null. */
  lostAt: Date | null;
}

/** What stands on or works a tile, which a clear has to wait for. */
export interface TileBusy {
  buildings: number;
  workers: number;
  guards: number;
}

/**
 * Clear storage (#242). Plain queries; the service decides the rules and runs
 * each command in one transaction.
 */
export interface ClearingRepo {
  transaction: <T>(fn: (repo: ClearingTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The tile's id at `q, r`, unlocked (a tile's place never changes). */
  tileIdAt: (mapId: string, q: number, r: number) => Promise<string | null>;
  /**
   * Locks these tiles in id order (`FOR NO KEY UPDATE`, like settle) until
   * commit: they can't change hands, and a gather, a gatherer or a guard
   * can't start on them meanwhile.
   */
  lockTiles: (tileIds: readonly string[]) => Promise<ClearTileRow[]>;
  /** What stands on the tile, and the owner's squishies working or on watch there. */
  tileBusy: (tileId: string, ownerUserId: string) => Promise<TileBusy>;
  /** The clear going on this tile, or the player's clear going anywhere on the map. */
  findActive: (
    where: { tileId: string } | { mapId: string; userId: string },
  ) => Promise<ClearRow | null>;
  insertClear: (clear: NewClear) => Promise<ClearRow>;
  /** The player's clears still going on tiles they own now, oldest first. */
  listActive: (mapId: string, userId: string) => Promise<ClearRow[]>;
  /** Every clear of the player's still going, wherever its tile went, in id order. Unlocked. */
  listToSettle: (mapId: string, userId: string) => Promise<SettleClearRow[]>;
  /** Row-locks these clears in id order until commit and reads them again. */
  lockToSettle: (clearIds: readonly string[]) => Promise<SettleClearRow[]>;
  /** Ends a clear still going; false if it had already ended. */
  endClear: (clearId: string, end: { reason: ClearEndReason; at: Date }) => Promise<boolean>;
  /**
   * Turns the tile into cleared land: its terrain becomes `clearing` and its
   * node goes, but only while it's still `fromTerrain` (the land the clear
   * started on; a trading post or other land made since stays as it is).
   * True when it wrote. The caller holds the tile's lock.
   */
  clearTile: (tileId: string, fromTerrain: string) => Promise<boolean>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface ClearingTxRepo extends ClearingRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const clearColumns = {
  id: tileClears.id,
  mapId: tileClears.mapId,
  userId: tileClears.userId,
  tileId: tileClears.tileId,
  q: tiles.q,
  r: tiles.r,
  fromTerrain: tileClears.fromTerrain,
  fromNode: tileClears.fromNode,
  tool: tileClears.tool,
  drop: tileClears.drop,
  startedAt: tileClears.startedAt,
  readyAt: tileClears.readyAt,
  endedAt: tileClears.endedAt,
  endReason: tileClears.endReason,
};

const settleColumns = {
  ...clearColumns,
  tileOwner: tiles.ownerUserId,
  lostAt: firstCaptureSince(tileClears.tileId, tileClears.startedAt),
};

type ClearSelect = Omit<ClearRow, 'drop' | 'endReason'> & {
  drop: unknown;
  endReason: string | null;
};

const toClear = (row: ClearSelect): ClearRow => ({
  ...row,
  // JSON is checked on read, so a hand-edited row fails loudly.
  drop: ItemCountsSchema.parse(row.drop),
  endReason: row.endReason === 'cleared' || row.endReason === 'lost' ? row.endReason : null,
});

/**
 * Is the player clearing this tile? Gathers, gatherers and guards don't start
 * on land being cleared (#242): its spot is about to go into the clear's
 * drop. The caller holds the tile's lock, which a clear's start takes too.
 */
export async function clearGoingOn(db: Executor, tileId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tileClears.id })
    .from(tileClears)
    .where(
      and(eq(tileClears.tileId, tileId), eq(tileClears.userId, userId), isNull(tileClears.endedAt)),
    )
    .limit(1);
  return row !== undefined;
}

export function createClearingRepo(db: Executor): ClearingRepo {
  return queries(db);
}

function createClearingTxRepo(tx: Transaction): ClearingTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): ClearingRepo {
  const selectClears = () =>
    db.select(clearColumns).from(tileClears).innerJoin(tiles, eq(tiles.id, tileClears.tileId));
  const selectToSettle = () =>
    db.select(settleColumns).from(tileClears).innerJoin(tiles, eq(tiles.id, tileClears.tileId));
  const toSettle = ({
    tileOwner,
    lostAt,
    ...row
  }: Awaited<ReturnType<typeof selectToSettle>>[number]): SettleClearRow => ({
    ...toClear(row),
    tileOwner,
    lostAt,
  });
  const active = isNull(tileClears.endedAt);

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createClearingTxRepo(tx), tx)),

    tileIdAt: async (mapId, q, r) => {
      const [row] = await db
        .select({ id: tiles.id })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)));
      return row?.id ?? null;
    },

    lockTiles: async (tileIds) => {
      if (tileIds.length === 0) return [];
      return (
        db
          .select({
            id: tiles.id,
            q: tiles.q,
            r: tiles.r,
            terrain: tiles.terrain,
            ownerUserId: tiles.ownerUserId,
            nodeResource: tiles.nodeResource,
            homeSlot: tiles.homeSlot,
          })
          .from(tiles)
          .where(inArray(tiles.id, [...new Set(tileIds)]))
          // Id order (tech spec §7 "Lock order"), so two transactions never deadlock.
          .orderBy(asc(tiles.id))
          .for('no key update')
      );
    },

    tileBusy: async (tileId, ownerUserId) => {
      // Only the owner's squishies: a previous owner's left-behind work row isn't working here.
      const theirs = eq(squishies.ownerUserId, ownerUserId);
      const [[built], [work], [guard]] = await Promise.all([
        db.select({ n: count() }).from(buildings).where(eq(buildings.tileId, tileId)),
        db
          .select({ n: count() })
          .from(squishies)
          .where(and(eq(squishies.workTileId, tileId), theirs)),
        db
          .select({ n: count() })
          .from(tileDefenders)
          .innerJoin(squishies, eq(squishies.id, tileDefenders.squishyId))
          .where(and(eq(tileDefenders.tileId, tileId), theirs)),
      ]);
      return {
        buildings: built?.n ?? 0,
        workers: work?.n ?? 0,
        guards: guard?.n ?? 0,
      };
    },

    findActive: async (where) => {
      const match =
        'tileId' in where
          ? eq(tileClears.tileId, where.tileId)
          : and(eq(tileClears.mapId, where.mapId), eq(tileClears.userId, where.userId));
      const [row] = await selectClears().where(and(match, active));
      return row ? toClear(row) : null;
    },

    insertClear: async (clear) => {
      const [row] = await db.insert(tileClears).values(clear).returning({ id: tileClears.id });
      if (!row) throw new Error('insertClear: insert returned no row');
      const [inserted] = await selectClears().where(eq(tileClears.id, row.id));
      if (!inserted) throw new Error('insertClear: clear vanished');
      return toClear(inserted);
    },

    listActive: async (mapId, userId) =>
      (
        await selectClears()
          .where(
            and(
              eq(tileClears.mapId, mapId),
              eq(tileClears.userId, userId),
              active,
              eq(tiles.ownerUserId, userId),
            ),
          )
          .orderBy(asc(tileClears.startedAt), asc(tileClears.id))
      ).map(toClear),

    listToSettle: async (mapId, userId) =>
      (
        await selectToSettle()
          .where(and(eq(tileClears.mapId, mapId), eq(tileClears.userId, userId), active))
          .orderBy(asc(tileClears.id))
      ).map(toSettle),

    lockToSettle: async (clearIds) => {
      if (clearIds.length === 0) return [];
      // Rows of one kind lock in id order (tech spec §7).
      return (
        await selectToSettle()
          .where(inArray(tileClears.id, [...clearIds]))
          .orderBy(asc(tileClears.id))
          .for('update', { of: tileClears })
      ).map(toSettle);
    },

    endClear: async (clearId, end) => {
      const ended = await db
        .update(tileClears)
        .set({ endedAt: end.at, endReason: end.reason })
        .where(and(eq(tileClears.id, clearId), active))
        .returning({ id: tileClears.id });
      return ended.length > 0;
    },

    clearTile: async (tileId, fromTerrain) => {
      const written = await db
        .update(tiles)
        .set({ terrain: CLEARED_TERRAIN, nodeResource: null })
        .where(and(eq(tiles.id, tileId), eq(tiles.terrain, fromTerrain)))
        .returning({ id: tiles.id });
      return written.length > 0;
    },
  };
}
