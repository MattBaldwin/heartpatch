import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import { tileExplore, tiles } from '../../db/schema.js';

/** A tile as exploring needs it (read only: tiles belong to the maps module). */
export interface ExploreTileRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
}

/** A player's explore row for one tile (`tile_explore`). */
export interface ExploreRow {
  userId: string;
  tileId: string;
  mapId: string;
  layout: number;
  terrain: string;
  searched: number;
  spotCount: number;
  completedAt: Date | null;
  joinedAt: Date | null;
  pausedAt: Date | null;
  resumedAt: Date | null;
}

/** A fully explored row with where its tile is: what the homestead check reads. */
export interface ExploredRow extends ExploreRow {
  q: number;
  r: number;
}

const tileColumns = {
  id: tiles.id,
  q: tiles.q,
  r: tiles.r,
  terrain: tiles.terrain,
  ownerUserId: tiles.ownerUserId,
  homeSlot: tiles.homeSlot,
};

const rowColumns = {
  userId: tileExplore.userId,
  tileId: tileExplore.tileId,
  mapId: tileExplore.mapId,
  layout: tileExplore.layout,
  terrain: tileExplore.terrain,
  searched: tileExplore.searched,
  spotCount: tileExplore.spotCount,
  completedAt: tileExplore.completedAt,
  joinedAt: tileExplore.joinedAt,
  pausedAt: tileExplore.pausedAt,
  resumedAt: tileExplore.resumedAt,
};

/**
 * Explore storage (#199). Plain queries; the service decides the rules and
 * runs each command in one transaction, taking locks in the tech spec §7
 * order: the tile (step 6), then `tile_explore` rows in `(user_id, tile_id)`
 * order.
 */
export function createExploreRepo(db: Executor) {
  return {
    /** The tile at `q, r`, unlocked (the explore view's read). */
    findTileAt: async (mapId: string, q: number, r: number): Promise<ExploreTileRow | null> => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)));
      return row ?? null;
    },

    /** The tile at `q, r`, share-locked until commit so its owner can't change mid-search. */
    lockTileAt: async (mapId: string, q: number, r: number): Promise<ExploreTileRow | null> => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)))
        .for('share');
      return row ?? null;
    },

    /** Every tile on the map, for the homestead check (who owns what, and the home rings). */
    listTiles: (mapId: string): Promise<ExploreTileRow[]> =>
      db.select(tileColumns).from(tiles).where(eq(tiles.mapId, mapId)).orderBy(asc(tiles.id)),

    /** A player's row for a tile, unlocked. */
    findRow: async (userId: string, tileId: string): Promise<ExploreRow | null> => {
      const [row] = await db
        .select(rowColumns)
        .from(tileExplore)
        .where(and(eq(tileExplore.userId, userId), eq(tileExplore.tileId, tileId)));
      return row ?? null;
    },

    /** A player's row for a tile, row-locked until commit (after the tile's lock). */
    lockRow: async (userId: string, tileId: string): Promise<ExploreRow | null> => {
      const [row] = await db
        .select(rowColumns)
        .from(tileExplore)
        .where(and(eq(tileExplore.userId, userId), eq(tileExplore.tileId, tileId)))
        .for('update');
      return row ?? null;
    },

    /**
     * A new row for a player's first search on a tile, or the row already
     * there if a search raced this one (then locked, like `lockRow`).
     */
    insertRow: async (row: {
      userId: string;
      tileId: string;
      mapId: string;
      layout: number;
      terrain: string;
      spotCount: number;
      at: Date;
    }): Promise<ExploreRow> => {
      await db
        .insert(tileExplore)
        .values({
          userId: row.userId,
          tileId: row.tileId,
          mapId: row.mapId,
          layout: row.layout,
          terrain: row.terrain,
          spotCount: row.spotCount,
          updatedAt: row.at,
        })
        .onConflictDoNothing();
      const [locked] = await db
        .select(rowColumns)
        .from(tileExplore)
        .where(and(eq(tileExplore.userId, row.userId), eq(tileExplore.tileId, row.tileId)))
        .for('update');
      if (!locked) throw new Error('insertRow: row vanished');
      return locked;
    },

    /** Writes a row's progress (the caller holds its lock). */
    updateProgress: async (
      userId: string,
      tileId: string,
      progress: Pick<ExploreRow, 'layout' | 'terrain' | 'searched' | 'spotCount' | 'completedAt'> &
        Partial<Pick<ExploreRow, 'joinedAt' | 'pausedAt' | 'resumedAt'>>,
      at: Date,
    ): Promise<void> => {
      await db
        .update(tileExplore)
        .set({ ...progress, updatedAt: at })
        .where(and(eq(tileExplore.userId, userId), eq(tileExplore.tileId, tileId)));
    },

    /**
     * These players' fully explored rows on the map with their tiles' places,
     * row-locked in `(user_id, tile_id)` order (tech spec §7).
     */
    lockExplored: async (mapId: string, userIds: readonly string[]): Promise<ExploredRow[]> => {
      if (userIds.length === 0) return [];
      return db
        .select({ ...rowColumns, q: tiles.q, r: tiles.r })
        .from(tileExplore)
        .innerJoin(tiles, eq(tiles.id, tileExplore.tileId))
        .where(
          and(
            eq(tileExplore.mapId, mapId),
            inArray(tileExplore.userId, [...userIds]),
            isNotNull(tileExplore.completedAt),
          ),
        )
        .orderBy(asc(tileExplore.userId), asc(tileExplore.tileId))
        .for('update', { of: tileExplore });
    },

    /** Sets a row's homestead columns (the caller holds its lock). */
    setHomestead: async (
      userId: string,
      tileId: string,
      columns: Partial<Pick<ExploreRow, 'joinedAt' | 'pausedAt' | 'resumedAt'>>,
      at: Date,
    ): Promise<void> => {
      await db
        .update(tileExplore)
        .set({ ...columns, updatedAt: at })
        .where(and(eq(tileExplore.userId, userId), eq(tileExplore.tileId, tileId)));
    },

    /**
     * Every tile on the map its owner has fully explored, with its homestead
     * columns: the map view's ✨ and homestead looks. Unlocked.
     */
    listOwnersExplored: (mapId: string) =>
      db
        .select({
          q: tiles.q,
          r: tiles.r,
          joinedAt: tileExplore.joinedAt,
          pausedAt: tileExplore.pausedAt,
          resumedAt: tileExplore.resumedAt,
        })
        .from(tileExplore)
        .innerJoin(
          tiles,
          and(eq(tiles.id, tileExplore.tileId), eq(tiles.ownerUserId, tileExplore.userId)),
        )
        .where(and(eq(tileExplore.mapId, mapId), isNotNull(tileExplore.completedAt))),
  };
}

export type ExploreRepo = ReturnType<typeof createExploreRepo>;

/** The repo inside `exploreTransaction`: the only place it can write game events. */
export type ExploreTxRepo = ExploreRepo & {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: (event: NewGameEvent) => Promise<unknown>;
};

/** Runs `fn` in one transaction (a savepoint inside one), with the repo on it. */
export function exploreTransaction<T>(
  db: Executor,
  fn: (repo: ExploreTxRepo, tx: Executor) => Promise<T>,
): Promise<T> {
  return withTransaction(db, (tx) =>
    fn({ ...createExploreRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
  );
}
