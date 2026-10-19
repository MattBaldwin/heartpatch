import type { CommunityKindId, Hex } from '@heartpatch/shared';
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../../db/client.js';
import { communities, communityTiles, maps, tiles } from '../../db/schema.js';

/** A Hollowed Community to store (#306), its tiles already resolved to ids. */
export interface NewCommunity {
  name: string;
  kind: CommunityKindId;
  perkId: string;
  /** Server-only: its finds' seed (CLAUDE.md rule 6). */
  seed: string;
  seedTileId: string;
  /** Server-only: where the cellar key hides (CLAUDE.md rule 6). */
  keyTileId: string;
  /** Every village tile, square first. */
  tiles: readonly { tileId: string; piecesNeeded: number; cellar: boolean }[];
}

/** A community for the map view: public fields only, never its seed or key tile. */
export interface CommunityViewRow {
  id: string;
  name: string;
  restoredName: string | null;
  kind: CommunityKindId;
  ownerUserId: string | null;
  square: Hex;
  /** Square first, then (q, r) order, with whether each is fully restored. */
  tiles: (Hex & { restored: boolean })[];
}

/** A stored community as the boot pass's placement rule sees it. Server-only (the key tile). */
export interface PlacedCommunityRow {
  id: string;
  name: string;
  kind: CommunityKindId;
  square: Hex;
  tiles: Hex[];
  keyTile: Hex;
}

/** A patch map and how many communities it has (`listPatchCommunityCounts`). */
export interface MapCommunityCount {
  id: string;
  seed: string;
  maxPlayers: number;
  communities: number;
}

/**
 * Hollowed Communities storage (#306): `communities`, `community_tiles` and
 * `tiles.community_id`. Plain queries; callers run writes inside their own
 * transaction (a new map's, or the boot pass's).
 */
export interface CommunitiesRepo {
  /** Every tile's id on the map by `"q,r"`. */
  tileIdsByHex: (mapId: string) => Promise<Map<string, string>>;
  /**
   * Stores one community, its `community_tiles` rows, and marks its tiles
   * (`tiles.community_id`, only where unset). Returns its id and how many
   * tiles it marked.
   */
  insertCommunity: (mapId: string, row: NewCommunity) => Promise<{ id: string; marked: number }>;
  /** The map's communities for the view, in the order they were placed (id order). */
  listForView: (mapId: string) => Promise<CommunityViewRow[]>;
  /** The map's communities with their key tiles, for the placement rule. Server-only. */
  listPlaced: (mapId: string) => Promise<PlacedCommunityRow[]>;
  /** Patch maps with a seed, with their seats and community count, in id order. */
  listPatchCommunityCounts: () => Promise<MapCommunityCount[]>;
}

const hexOf = (q: number, r: number): Hex => ({ q, r });
const key = (h: Hex) => `${String(h.q)},${String(h.r)}`;

export function createCommunitiesRepo(db: Executor): CommunitiesRepo {
  /** Every village tile of the map's communities, square first, then (q, r). */
  const villageTiles = async (mapId: string) =>
    db
      .select({
        communityId: communityTiles.communityId,
        q: tiles.q,
        r: tiles.r,
        cellar: communityTiles.cellar,
        restored: sql<boolean>`${communityTiles.restoredAt} is not null`,
      })
      .from(communityTiles)
      .innerJoin(tiles, eq(tiles.id, communityTiles.tileId))
      .innerJoin(communities, eq(communities.id, communityTiles.communityId))
      .where(eq(communities.mapId, mapId))
      .orderBy(
        asc(communityTiles.communityId),
        sql`${communityTiles.cellar} desc`,
        asc(tiles.q),
        asc(tiles.r),
      );

  return {
    tileIdsByHex: async (mapId) => {
      const rows = await db
        .select({ id: tiles.id, q: tiles.q, r: tiles.r })
        .from(tiles)
        .where(eq(tiles.mapId, mapId));
      return new Map(rows.map((t) => [key(t), t.id]));
    },

    insertCommunity: async (mapId, row) => {
      const [stored] = await db
        .insert(communities)
        .values({
          mapId,
          name: row.name,
          kind: row.kind,
          perkId: row.perkId,
          seed: row.seed,
          seedTileId: row.seedTileId,
          keyTileId: row.keyTileId,
        })
        .returning({ id: communities.id });
      if (!stored) throw new Error('insertCommunity: insert returned no row');
      await db.insert(communityTiles).values(
        row.tiles.map((t) => ({
          communityId: stored.id,
          tileId: t.tileId,
          piecesNeeded: t.piecesNeeded,
          cellar: t.cellar,
        })),
      );
      const marked = await db
        .update(tiles)
        .set({ communityId: stored.id })
        .where(
          and(
            inArray(
              tiles.id,
              row.tiles.map((t) => t.tileId),
            ),
            isNull(tiles.communityId),
          ),
        )
        .returning({ id: tiles.id });
      return { id: stored.id, marked: marked.length };
    },

    listForView: async (mapId) => {
      const square = alias(tiles, 'square');
      const [rows, village] = await Promise.all([
        db
          .select({
            id: communities.id,
            name: communities.name,
            restoredName: communities.restoredName,
            kind: communities.kind,
            ownerUserId: communities.ownerUserId,
            q: square.q,
            r: square.r,
          })
          .from(communities)
          .innerJoin(square, eq(square.id, communities.seedTileId))
          .where(eq(communities.mapId, mapId))
          .orderBy(asc(communities.id)),
        villageTiles(mapId),
      ]);
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        restoredName: c.restoredName,
        kind: c.kind as CommunityKindId,
        ownerUserId: c.ownerUserId,
        square: hexOf(c.q, c.r),
        tiles: village
          .filter((t) => t.communityId === c.id)
          .map((t) => ({ q: t.q, r: t.r, restored: t.restored })),
      }));
    },

    listPlaced: async (mapId) => {
      const square = alias(tiles, 'square');
      const keyTile = alias(tiles, 'key_tile');
      const [rows, village] = await Promise.all([
        db
          .select({
            id: communities.id,
            name: communities.name,
            kind: communities.kind,
            q: square.q,
            r: square.r,
            keyQ: keyTile.q,
            keyR: keyTile.r,
          })
          .from(communities)
          .innerJoin(square, eq(square.id, communities.seedTileId))
          .innerJoin(keyTile, eq(keyTile.id, communities.keyTileId))
          .where(eq(communities.mapId, mapId))
          .orderBy(asc(communities.id)),
        villageTiles(mapId),
      ]);
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind as CommunityKindId,
        square: hexOf(c.q, c.r),
        tiles: village.filter((t) => t.communityId === c.id).map((t) => hexOf(t.q, t.r)),
        keyTile: hexOf(c.keyQ, c.keyR),
      }));
    },

    listPatchCommunityCounts: () =>
      db
        .select({
          id: maps.id,
          seed: sql<string>`${maps.seed}`,
          maxPlayers: maps.maxPlayers,
          communities: count(communities.id),
        })
        .from(maps)
        .leftJoin(communities, eq(communities.mapId, maps.id))
        .where(and(eq(maps.kind, 'multiplayer'), isNotNull(maps.seed)))
        .groupBy(maps.id)
        .orderBy(asc(maps.id)),
  };
}
