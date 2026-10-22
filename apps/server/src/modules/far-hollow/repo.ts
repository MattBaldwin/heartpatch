import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { farHollowExplore, journeys, maps, tiles } from '../../db/schema.js';

/** My progress on one tile of a season's far Hollow (#306 PR 6). */
export interface FarHollowRow {
  tileIndex: number;
  searched: number;
  completedAt: Date | null;
}

/** Whose far Hollow, in which season (its seed). */
export interface FarHollowKey {
  userId: string;
  mapId: string;
  seasonSeed: string;
}

/**
 * Storage for the far Hollow (#306 PR 6). Plain queries; the service
 * decides. Its rows are tech spec §7 step 6, after `tile_explore`: a search
 * locks all of the season's rows (tile order), and the far road's finish
 * writes them after the battle and its `journeys` row (5b).
 */
export interface FarHollowRepo {
  /** The map's secret seed (null on hand-authored maps) and its time zone. Server-only. */
  findMap: (mapId: string) => Promise<{ seed: string | null; timeZone: string } | null>;
  /** My rows for a season's far Hollow, in tile order (none until I arrive). */
  listRows: (key: FarHollowKey) => Promise<FarHollowRow[]>;
  /** The same rows, row-locked until commit (step 6, tile order). */
  lockRows: (key: FarHollowKey) => Promise<FarHollowRow[]>;
  /**
   * I arrived in a season's far Hollow: a row for each of its tiles (rows
   * already there stay as they are) and last season's rows gone. True when
   * this was the arrival (no rows were there yet).
   */
  arrive: (key: FarHollowKey, tileCount: number) => Promise<boolean>;
  setProgress: (
    key: FarHollowKey,
    tileIndex: number,
    progress: { searched: number; completedAt: Date | null },
  ) => Promise<void>;
  /** The post my latest won far road set off from, for an event's place on the patch. */
  roadPost: (mapId: string, userId: string) => Promise<{ q: number; r: number } | null>;
}

const rowColumns = {
  tileIndex: farHollowExplore.tileIndex,
  searched: farHollowExplore.searched,
  completedAt: farHollowExplore.completedAt,
};

const whereKey = (key: FarHollowKey) =>
  and(
    eq(farHollowExplore.userId, key.userId),
    eq(farHollowExplore.mapId, key.mapId),
    eq(farHollowExplore.seasonSeed, key.seasonSeed),
  );

export function createFarHollowRepo(db: Executor): FarHollowRepo {
  return {
    findMap: async (mapId) => {
      const [row] = await db
        .select({ seed: maps.seed, timeZone: maps.timeZone })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row ?? null;
    },

    listRows: (key) =>
      db
        .select(rowColumns)
        .from(farHollowExplore)
        .where(whereKey(key))
        .orderBy(asc(farHollowExplore.tileIndex)),

    lockRows: (key) =>
      db
        .select(rowColumns)
        .from(farHollowExplore)
        .where(whereKey(key))
        .orderBy(asc(farHollowExplore.tileIndex))
        .for('update'),

    arrive: async (key, tileCount) => {
      // Last season's rows first (only this player's own searches write them,
      // and a search needs this season's), so the table keeps one season each.
      await db
        .delete(farHollowExplore)
        .where(
          and(
            eq(farHollowExplore.userId, key.userId),
            eq(farHollowExplore.mapId, key.mapId),
            ne(farHollowExplore.seasonSeed, key.seasonSeed),
          ),
        );
      const inserted = await db
        .insert(farHollowExplore)
        .values(Array.from({ length: tileCount }, (_, tileIndex) => ({ ...key, tileIndex })))
        .onConflictDoNothing()
        .returning({ tileIndex: farHollowExplore.tileIndex });
      return inserted.length === tileCount;
    },

    setProgress: async (key, tileIndex, progress) => {
      await db
        .update(farHollowExplore)
        .set(progress)
        .where(and(whereKey(key), eq(farHollowExplore.tileIndex, tileIndex)));
    },

    roadPost: async (mapId, userId) => {
      const [row] = await db
        .select({ q: tiles.q, r: tiles.r })
        .from(journeys)
        .innerJoin(tiles, eq(tiles.id, journeys.postTileId))
        .where(
          and(
            eq(journeys.mapId, mapId),
            eq(journeys.userId, userId),
            eq(journeys.kind, 'far-hollow'),
            eq(journeys.outcome, 'won'),
          ),
        )
        .orderBy(desc(journeys.endedAt))
        .limit(1);
      return row ?? null;
    },
  };
}
