import {
  CLEARED_TERRAIN,
  CLEARING_RULES,
  clearToolFor,
  EXPLORE_RULES,
  exploreLayout,
  heartSeedOf,
  hexDistance,
  searchSpots,
  type DevHomesteadRequest,
  type Seed,
} from '@heartpatch/shared';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import { tileExplore, tiles } from '../../db/schema.js';

/**
 * Land no tool clears in Phase 1 (owner Q5) that the dev homestead route
 * clears itself when its ring has nothing a tool clears (#429). Never a lake,
 * Juniper's Gap or a trading post.
 */
const DEV_CLEARABLE: ReadonlySet<string> = new Set(['old-forest', 'pumpkin-fields']);

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
    /**
     * Dev only (`HP_DEV_SQUISHY_GRANTS`, e2e and phone testing): a free neutral
     * tile near the player's home becomes theirs, fully explored (#295, #242).
     * By default it's two steps from the Heart Seed and joined to home, so a
     * homestead building can go up at once; `joined: false` puts it three
     * steps out, not joined, and `'napping'` the same but cut off from home
     * after joining. `terrain` and `nodeResource` set its land and spot (none
     * by default). It never touches the player's other land outside home.
     * Its row is every one of its real spots searched under today's layout
     * (`seed` is the map's), replacing any row left from before, so a search
     * there finds it finished as a real one would (#511). Null when there's
     * no such tile.
     */
    devMakeHomestead: async (
      mapId: string,
      userId: string,
      at: Date,
      seed: Seed,
      ask: DevHomesteadRequest = {},
    ): Promise<{ q: number; r: number } | null> => {
      const all = await db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          terrain: tiles.terrain,
          ownerUserId: tiles.ownerUserId,
          homeSlot: tiles.homeSlot,
        })
        .from(tiles)
        .where(eq(tiles.mapId, mapId))
        .orderBy(asc(tiles.id));
      // The Heart Seed: the middle of my seven home tiles (every one of them
      // carries my home slot, so "slot 0" alone could pick a ring tile, #429).
      const heart = heartSeedOf(all.filter((t) => t.ownerUserId === userId && t.homeSlot !== null));
      // Land a building can go on once its spot is gone: what a tool clears,
      // or cleared land (never a lake, Juniper's Gap or a trading post).
      const buildable = (terrain: string) =>
        terrain === CLEARED_TERRAIN || clearToolFor(terrain, CLEARING_RULES) !== null;
      // Two steps out touches home, so it joins. Asked for one that hasn't
      // (#242), three steps out touches none of it, so it stays unjoined.
      // Neither touches my other land outside home: a homestead next door
      // would join an unjoined one at the next refresh, and a new homestead
      // would join land of mine beside it (#242 review).
      const touchesHome = ask.joined === true || ask.joined === undefined;
      // A napping one is out there too: it joined once and was cut off since.
      const napping = ask.joined === 'napping';
      const mineOut = all.filter((t) => t.ownerUserId === userId && t.homeSlot === null);
      const near = heart
        ? all.filter(
            (t) =>
              t.ownerUserId === null &&
              t.homeSlot === null &&
              hexDistance(t, heart) === (touchesHome ? 2 : 3) &&
              !mineOut.some((m) => hexDistance(m, t) === 1),
          )
        : [];
      // A home deep in Old Forest or Pumpkin Fields can have nothing a tool
      // clears two steps out (about 1 map in 30, #429): then one of those
      // tiles is cleared here, as a finished clear would leave it. Asked for
      // its land, any of that ring's land will do.
      const tile = ask.terrain
        ? near.find((t) => buildable(t.terrain) || DEV_CLEARABLE.has(t.terrain))
        : (near.find((t) => buildable(t.terrain)) ??
          near.find((t) => DEV_CLEARABLE.has(t.terrain)));
      if (!tile) return null;
      const terrain = ask.terrain ?? (buildable(tile.terrain) ? tile.terrain : CLEARED_TERRAIN);
      const claimed = await db
        .update(tiles)
        .set({ ownerUserId: userId, nodeResource: ask.nodeResource ?? null, terrain })
        .where(and(eq(tiles.id, tile.id), isNull(tiles.ownerUserId)))
        .returning({ id: tiles.id });
      // Someone took it meanwhile: nothing made.
      if (claimed.length === 0) return null;
      // A terrain with no spots (none today; search refuses them) gets one, for
      // `tile_explore_spot_count_range`.
      const spotCount =
        searchSpots(seed, { q: tile.q, r: tile.r, terrain }, EXPLORE_RULES)?.length || 1;
      const row = {
        layout: exploreLayout(terrain, EXPLORE_RULES),
        terrain,
        searched: (1 << spotCount) - 1,
        spotCount,
        completedAt: at,
        joinedAt: touchesHome || napping ? at : null,
        pausedAt: napping ? at : null,
        resumedAt: null,
        updatedAt: at,
      };
      await db
        .insert(tileExplore)
        .values({ userId, tileId: tile.id, mapId, ...row })
        .onConflictDoUpdate({ target: [tileExplore.userId, tileExplore.tileId], set: row });
      return { q: tile.q, r: tile.r };
    },

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
