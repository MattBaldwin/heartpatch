import { TRADING_POST_TERRAIN } from '@heartpatch/shared';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { keeperWarmth, maps, patchTrees, tiles } from '../../db/schema.js';

/** A trading post on the patch, for choosing and labelling the tree's post. */
export interface TreePostRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
}

/** A `patch_trees` row. */
export interface PatchTreeDbRow {
  mapId: string;
  postTileId: string;
  ornaments: number;
  starLitAt: Date | null;
}

/** One pair's warmth, as `keeper_warmth` stores it (`userAId < userBId`). */
export interface WarmthDbRow {
  userAId: string;
  userBId: string;
  warmth: number;
}

/**
 * The Patch Tree's rows (#37 2c): `patch_trees` (one per patch) and
 * `keeper_warmth` (one per pair of patch-mates, stored ordered). Writers run
 * inside the gift pickup's transaction, after its bag rows (tech spec §7
 * step 12c): the pairs' warmth rows in pair order, then the tree row.
 */
export interface TreeRepo {
  /** The patch's kind and time zone (a plain read). */
  findMap: (
    mapId: string,
  ) => Promise<{ kind: 'multiplayer' | 'tutorial'; timeZone: string } | null>;
  /** The patch's trading posts (a plain read). */
  listPosts: (mapId: string) => Promise<TreePostRow[]>;
  /** The tree row, or null when it isn't planted yet. A plain read. */
  findTree: (mapId: string) => Promise<PatchTreeDbRow | null>;
  /** The tree row under `FOR UPDATE` (step 12c), or null. */
  lockTree: (mapId: string) => Promise<PatchTreeDbRow | null>;
  /** Plants the tree at `postTileId`; a no-op if another read planted it first. */
  plant: (mapId: string, postTileId: string, at: Date) => Promise<void>;
  /** Writes the tree's new total and, once, when its star lit. */
  setOrnaments: (mapId: string, ornaments: number, starLitAt: Date | null) => Promise<void>;
  /**
   * Adds `by` to an ordered pair's warmth (`userAId < userBId`), making the
   * row if it's the pair's first. The upsert takes the row's lock.
   */
  addWarmth: (
    mapId: string,
    userAId: string,
    userBId: string,
    by: number,
    at: Date,
  ) => Promise<void>;
  /** Every pair with this Keeper that has any warmth (≥ 1). A plain read. */
  warmthOf: (mapId: string, userId: string) => Promise<WarmthDbRow[]>;
}

export function createTreeRepo(db: Executor): TreeRepo {
  const treeColumns = {
    mapId: patchTrees.mapId,
    postTileId: patchTrees.postTileId,
    ornaments: patchTrees.ornaments,
    starLitAt: patchTrees.starLitAt,
  };
  return {
    findMap: async (mapId) => {
      const [row] = await db
        .select({ kind: maps.kind, timeZone: maps.timeZone })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row ?? null;
    },

    listPosts: (mapId) =>
      db
        .select({ id: tiles.id, q: tiles.q, r: tiles.r, terrain: tiles.terrain })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.terrain, TRADING_POST_TERRAIN))),

    findTree: async (mapId) => {
      const [row] = await db
        .select(treeColumns)
        .from(patchTrees)
        .where(eq(patchTrees.mapId, mapId));
      return row ?? null;
    },

    lockTree: async (mapId) => {
      const [row] = await db
        .select(treeColumns)
        .from(patchTrees)
        .where(eq(patchTrees.mapId, mapId))
        .for('update');
      return row ?? null;
    },

    plant: async (mapId, postTileId, at) => {
      await db
        .insert(patchTrees)
        .values({ mapId, postTileId, ornaments: 0, starLitAt: null, createdAt: at })
        .onConflictDoNothing({ target: patchTrees.mapId });
    },

    setOrnaments: async (mapId, ornaments, starLitAt) => {
      await db.update(patchTrees).set({ ornaments, starLitAt }).where(eq(patchTrees.mapId, mapId));
    },

    addWarmth: async (mapId, userAId, userBId, by, at) => {
      await db
        .insert(keeperWarmth)
        .values({ mapId, userAId, userBId, warmth: by, updatedAt: at })
        .onConflictDoUpdate({
          target: [keeperWarmth.mapId, keeperWarmth.userAId, keeperWarmth.userBId],
          set: { warmth: sql`${keeperWarmth.warmth} + ${by}`, updatedAt: at },
        });
    },

    warmthOf: (mapId, userId) =>
      db
        .select({
          userAId: keeperWarmth.userAId,
          userBId: keeperWarmth.userBId,
          warmth: keeperWarmth.warmth,
        })
        .from(keeperWarmth)
        .where(
          and(
            eq(keeperWarmth.mapId, mapId),
            or(eq(keeperWarmth.userAId, userId), eq(keeperWarmth.userBId, userId)),
            gte(keeperWarmth.warmth, 1),
          ),
        ),
  };
}
