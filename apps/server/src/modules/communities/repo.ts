import type { CommunityKindId, Hex } from '@heartpatch/shared';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, sql, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  buildings,
  communities,
  communityPieces,
  communityTiles,
  maps,
  resourceLedger,
  tileClears,
  tiles,
} from '../../db/schema.js';

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
  /** Its winner typed its name (`named_at_level` set). */
  named: boolean;
  square: Hex;
  /** Square first, then (q, r) order, with whether each is fully restored. */
  tiles: (Hex & { restored: boolean })[];
  /**
   * Server-only (rule 6): where the cellar key hides. The view sends it to
   * the village's winner alone, while they hunt for it (PR 2c).
   */
  keyTile: Hex;
  /** Its winner dug the key up (PR 2c). */
  keyFound: boolean;
  /** The cellar under the square is open (PR 2c). */
  cellarOpen: boolean;
}

/** A village's hidden cellar (PR 2c): the square's `community_tiles` row. */
export interface CellarRow {
  /** The square's tile id. */
  tileId: string;
  openedAt: Date | null;
  /** Its spots searched, one bit a spot. */
  searched: number;
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

/** A community as restoring and naming read it (#306 PR 3). Server-only: its seed. */
export interface CommunityRow {
  id: string;
  name: string;
  restoredName: string | null;
  namedAtLevel: number | null;
  kind: CommunityKindId;
  ownerUserId: string | null;
  seedTileId: string;
  /** Server-only (rule 6): its finds' seed and where its cellar key hides (PR 2c). */
  seed: string;
  keyTileId: string;
  /** When its winner dug the cellar key up (PR 2c), or null. */
  keyRevealedAt: Date | null;
}

/** One village tile's restoring progress, with where it is. */
export interface CommunityTileRow {
  tileId: string;
  q: number;
  r: number;
  piecesNeeded: number;
  piecesDone: number;
  restoredBy: string | null;
  restoredAt: Date | null;
}

/** A tile restoring may write: a village tile or its ring, locked. */
export interface RestoreTileRow extends Hex {
  id: string;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  communityId: string | null;
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

  // Restoring, claiming and naming (#306 PR 3).
  /** The community on this map, unlocked; null if there's none. */
  findCommunity: (mapId: string, communityId: string) => Promise<CommunityRow | null>;
  /** Its village tiles' progress, square first, then (q, r); `lock` takes them in tile id order. */
  listCommunityTiles: (communityId: string, lock?: boolean) => Promise<CommunityTileRow[]>;
  /** The map's tiles at these places (any that exist), locked `FOR NO KEY UPDATE` in id order. */
  lockTilesAt: (mapId: string, at: readonly Hex[]) => Promise<RestoreTileRow[]>;
  /** The community row, `FOR UPDATE` (step 6, after its tiles). */
  lockCommunity: (communityId: string) => Promise<CommunityRow | null>;
  /** One more piece on a village tile, with its ledger row; returns the ledger row's id. */
  addPiece: (input: {
    tileId: string;
    userId: string;
    paid: Record<string, number>;
    at: Date;
  }) => Promise<string>;
  /** The tile's last piece went in: who restored it, and when. */
  markRestored: (tileId: string, userId: string, at: Date) => Promise<void>;
  /** Who put pieces on this tile, most first (then by user id). */
  helpers: (tileId: string) => Promise<{ userId: string; pieces: number }[]>;
  /** The village is won: its owner, when, and the name it wears until they type one. */
  win: (communityId: string, userId: string, at: Date, name: string) => Promise<void>;
  /** The winner's ring: these tiles become their home tiles, marked as this village's. */
  plantRing: (
    tileIds: readonly string[],
    input: { userId: string; homeSlot: number; communityId: string },
  ) => Promise<void>;
  /** Of these tiles, the ones with a building or a clear going on (a won ring leaves them be). */
  busyTiles: (tileIds: readonly string[]) => Promise<Set<string>>;
  /** Whether this village tile has all its pieces back (PR 4: then it's ordinary land). */
  isRestored: (tileId: string) => Promise<boolean>;
  /**
   * A winner left (#306 PR 3, owner 2026-10-19): their rings, already
   * released with their land (`releaseTiles`, which holds the tiles), stop
   * being home tiles; the grounds stop being the village's. Their villages
   * stay restored but have no owner and lose the name. Locks the community
   * rows in id order. Returns how many villages it uprooted.
   */
  uproot: (mapId: string, userId: string) => Promise<number>;
  /** Dev only: these tiles one piece short of restored. */
  devAlmost: (tileIds: readonly string[]) => Promise<void>;
  /** Dev only (PR 2c): these wild tiles become `userId`'s, locked in id order first (step 6). */
  devClaim: (tileIds: readonly string[], userId: string) => Promise<void>;
  /** Dev only: the village becomes this kind (its perk with it). */
  devKind: (communityId: string, kind: CommunityKindId) => Promise<void>;
  /** The winner typed a name, at their village seed's level. */
  setName: (communityId: string, name: string, level: number) => Promise<void>;
  /** The map's won villages as their perks need them (PR 3b): kind, winner and square. */
  wonVillages: (mapId: string) => Promise<WonVillageRow[]>;
  // The key hunt and the hidden cellar (PR 2c).
  /** Where a tile is (the key's, the square's), unlocked: only read. */
  tileById: (tileId: string) => Promise<(Hex & { id: string }) | null>;
  /** The key is dug up: when (the community row is locked). */
  revealKey: (communityId: string, at: Date) => Promise<void>;
  /** The village's cellar (the square's row); `lock` takes it `FOR UPDATE` (after the community row). */
  cellarOf: (communityId: string, lock?: boolean) => Promise<CellarRow | null>;
  /** The cellar opens. */
  openCellar: (tileId: string, at: Date) => Promise<void>;
  /** The cellar's searched spots. */
  setCellarSearched: (tileId: string, searched: number) => Promise<void>;
  /** Of these villages, the ones whose morning gift `userId` has collected since `since`. */
  giftsCollectedSince: (
    mapId: string,
    userId: string,
    communityIds: readonly string[],
    since: Date,
  ) => Promise<Set<string>>;
}

/** A won village for its perks (#306 PR 3b). */
export interface WonVillageRow {
  id: string;
  kind: CommunityKindId;
  ownerUserId: string;
  square: Hex;
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
      const keyTile = alias(tiles, 'key_tile');
      const [rows, village] = await Promise.all([
        db
          .select({
            id: communities.id,
            name: communities.name,
            restoredName: communities.restoredName,
            kind: communities.kind,
            ownerUserId: communities.ownerUserId,
            named: sql<boolean>`${communities.namedAtLevel} is not null`,
            q: square.q,
            r: square.r,
            keyQ: keyTile.q,
            keyR: keyTile.r,
            keyFound: sql<boolean>`${communities.keyRevealedAt} is not null`,
            cellarOpen: sql<boolean>`${communityTiles.cellarOpenedAt} is not null`,
          })
          .from(communities)
          .innerJoin(square, eq(square.id, communities.seedTileId))
          .innerJoin(keyTile, eq(keyTile.id, communities.keyTileId))
          .leftJoin(communityTiles, eq(communityTiles.tileId, communities.seedTileId))
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
        named: c.named,
        square: hexOf(c.q, c.r),
        tiles: village
          .filter((t) => t.communityId === c.id)
          .map((t) => ({ q: t.q, r: t.r, restored: t.restored })),
        keyTile: hexOf(c.keyQ, c.keyR),
        keyFound: c.keyFound,
        cellarOpen: c.cellarOpen,
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

    findCommunity: async (mapId, communityId) => {
      const [row] = await db
        .select(communityColumns)
        .from(communities)
        .where(and(eq(communities.id, communityId), eq(communities.mapId, mapId)));
      return row ? { ...row, kind: row.kind as CommunityKindId } : null;
    },

    listCommunityTiles: async (communityId, lock = false) => {
      const query = db
        .select({
          tileId: communityTiles.tileId,
          q: tiles.q,
          r: tiles.r,
          piecesNeeded: communityTiles.piecesNeeded,
          piecesDone: communityTiles.piecesDone,
          restoredBy: communityTiles.restoredBy,
          restoredAt: communityTiles.restoredAt,
          cellar: communityTiles.cellar,
        })
        .from(communityTiles)
        .innerJoin(tiles, eq(tiles.id, communityTiles.tileId))
        .where(eq(communityTiles.communityId, communityId))
        .orderBy(asc(communityTiles.tileId));
      const rows = lock ? await query.for('update', { of: communityTiles }) : await query;
      return rows
        .sort((a, b) => Number(b.cellar) - Number(a.cellar) || a.q - b.q || a.r - b.r)
        .map((row) => ({
          tileId: row.tileId,
          q: row.q,
          r: row.r,
          piecesNeeded: row.piecesNeeded,
          piecesDone: row.piecesDone,
          restoredBy: row.restoredBy,
          restoredAt: row.restoredAt,
        }));
    },

    lockTilesAt: async (mapId, at) => {
      if (at.length === 0) return [];
      return db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          terrain: tiles.terrain,
          ownerUserId: tiles.ownerUserId,
          homeSlot: tiles.homeSlot,
          communityId: tiles.communityId,
        })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            sql`(${tiles.q}, ${tiles.r}) in (${sql.join(
              at.map((h) => sql`(${h.q}, ${h.r})`),
              sql`, `,
            )})`,
          ),
        )
        .orderBy(asc(tiles.id))
        .for('no key update');
    },

    lockCommunity: async (communityId) => {
      const [row] = await db
        .select(communityColumns)
        .from(communities)
        .where(eq(communities.id, communityId))
        .for('update');
      return row ? { ...row, kind: row.kind as CommunityKindId } : null;
    },

    addPiece: async ({ tileId, userId, paid, at }) => {
      await db
        .update(communityTiles)
        .set({ piecesDone: sql`${communityTiles.piecesDone} + 1` })
        .where(eq(communityTiles.tileId, tileId));
      const [row] = await db
        .insert(communityPieces)
        .values({ tileId, userId, pieces: 1, paid, at })
        .returning({ id: communityPieces.id });
      if (!row) throw new Error('addPiece: insert returned no row');
      return row.id;
    },

    markRestored: async (tileId, userId, at) => {
      await db
        .update(communityTiles)
        .set({ restoredBy: userId, restoredAt: at })
        .where(eq(communityTiles.tileId, tileId));
    },

    helpers: async (tileId) => {
      const pieces = sum(communityPieces.pieces).mapWith(Number);
      return db
        .select({ userId: communityPieces.userId, pieces })
        .from(communityPieces)
        .where(eq(communityPieces.tileId, tileId))
        .groupBy(communityPieces.userId)
        .orderBy(desc(pieces), asc(communityPieces.userId));
    },

    win: async (communityId, userId, at, name) => {
      await db
        .update(communities)
        .set({ ownerUserId: userId, claimedAt: at, restoredName: name, namedAtLevel: null })
        .where(eq(communities.id, communityId));
    },

    plantRing: async (tileIds, { userId, homeSlot, communityId }) => {
      if (tileIds.length === 0) return;
      await db
        .update(tiles)
        .set({ ownerUserId: userId, homeSlot, communityId })
        .where(inArray(tiles.id, [...tileIds]));
    },

    busyTiles: async (tileIds) => {
      if (tileIds.length === 0) return new Set();
      const [built, clearing] = await Promise.all([
        db
          .select({ id: buildings.tileId })
          .from(buildings)
          .where(inArray(buildings.tileId, [...tileIds])),
        db
          .select({ id: tileClears.tileId })
          .from(tileClears)
          .where(and(inArray(tileClears.tileId, [...tileIds]), isNull(tileClears.endedAt))),
      ]);
      return new Set([...built, ...clearing].map((r) => r.id));
    },

    isRestored: async (tileId) => {
      const [row] = await db
        .select({ one: sql`1` })
        .from(communityTiles)
        .where(and(eq(communityTiles.tileId, tileId), isNotNull(communityTiles.restoredAt)));
      return row !== undefined;
    },

    uproot: async (mapId, userId) => {
      const owned = await db
        .select({ id: communities.id })
        .from(communities)
        .where(and(eq(communities.mapId, mapId), eq(communities.ownerUserId, userId)))
        .orderBy(asc(communities.id))
        .for('update');
      if (owned.length === 0) return 0;
      // Released land has no owner: the leaver's ring is the only ownerless
      // home land that belongs to a village.
      await db
        .update(tiles)
        .set({
          homeSlot: null,
          communityId: sql`case when exists (
            select 1 from ${communityTiles} where ${communityTiles.tileId} = ${tiles.id}
          ) then ${tiles.communityId} else null end`,
        })
        .where(
          and(
            eq(tiles.mapId, mapId),
            isNull(tiles.ownerUserId),
            isNotNull(tiles.homeSlot),
            isNotNull(tiles.communityId),
          ),
        );
      const ids = owned.map((c) => c.id);
      // The key and the cellar go with the winner too (PR 2c), as the name
      // does: whoever wins the village next hunts for its key afresh.
      await db
        .update(communities)
        .set({
          ownerUserId: null,
          claimedAt: null,
          restoredName: null,
          namedAtLevel: null,
          keyRevealedAt: null,
        })
        .where(inArray(communities.id, ids));
      // Their cellars' rows, in tile id order (step 6, after the community rows).
      await db
        .select({ id: communityTiles.tileId })
        .from(communityTiles)
        .where(and(inArray(communityTiles.communityId, ids), eq(communityTiles.cellar, true)))
        .orderBy(asc(communityTiles.tileId))
        .for('update');
      await db
        .update(communityTiles)
        .set({ cellarOpenedAt: null, cellarSearched: 0 })
        .where(and(inArray(communityTiles.communityId, ids), eq(communityTiles.cellar, true)));
      return owned.length;
    },

    devAlmost: async (tileIds) => {
      if (tileIds.length === 0) return;
      await db
        .update(communityTiles)
        .set({ piecesDone: sql`${communityTiles.piecesNeeded} - 1` })
        .where(inArray(communityTiles.tileId, [...tileIds]));
    },

    devClaim: async (tileIds, userId) => {
      if (tileIds.length === 0) return;
      await db
        .select({ id: tiles.id })
        .from(tiles)
        .where(inArray(tiles.id, [...tileIds]))
        .orderBy(asc(tiles.id))
        .for('no key update');
      await db
        .update(tiles)
        .set({ ownerUserId: userId })
        .where(and(inArray(tiles.id, [...tileIds]), isNull(tiles.ownerUserId)));
    },

    devKind: async (communityId, kind) => {
      await db
        .update(communities)
        .set({ kind, perkId: kind })
        .where(eq(communities.id, communityId));
    },

    setName: async (communityId, name, level) => {
      await db
        .update(communities)
        .set({ restoredName: name, namedAtLevel: level })
        .where(eq(communities.id, communityId));
    },

    wonVillages: async (mapId) => {
      const rows = await db
        .select({
          id: communities.id,
          kind: communities.kind,
          ownerUserId: communities.ownerUserId,
          q: tiles.q,
          r: tiles.r,
        })
        .from(communities)
        .innerJoin(tiles, eq(tiles.id, communities.seedTileId))
        .where(and(eq(communities.mapId, mapId), isNotNull(communities.ownerUserId)))
        .orderBy(asc(communities.id));
      return rows.flatMap(({ id, kind, ownerUserId, q, r }) =>
        ownerUserId === null
          ? []
          : [{ id, kind: kind as CommunityKindId, ownerUserId, square: hexOf(q, r) }],
      );
    },

    tileById: async (tileId) => {
      const [row] = await db
        .select({ id: tiles.id, q: tiles.q, r: tiles.r })
        .from(tiles)
        .where(eq(tiles.id, tileId));
      return row ?? null;
    },

    revealKey: async (communityId, at) => {
      await db
        .update(communities)
        .set({ keyRevealedAt: at })
        .where(eq(communities.id, communityId));
    },

    cellarOf: async (communityId, lock = false) => {
      const query = db
        .select({
          tileId: communityTiles.tileId,
          openedAt: communityTiles.cellarOpenedAt,
          searched: communityTiles.cellarSearched,
        })
        .from(communityTiles)
        .where(and(eq(communityTiles.communityId, communityId), eq(communityTiles.cellar, true)));
      const [row] = lock ? await query.for('update') : await query;
      return row ?? null;
    },

    openCellar: async (tileId, at) => {
      await db
        .update(communityTiles)
        .set({ cellarOpenedAt: at })
        .where(eq(communityTiles.tileId, tileId));
    },

    setCellarSearched: async (tileId, searched) => {
      await db
        .update(communityTiles)
        .set({ cellarSearched: searched })
        .where(eq(communityTiles.tileId, tileId));
    },

    giftsCollectedSince: async (mapId, userId, communityIds, since) => {
      if (communityIds.length === 0) return new Set();
      const rows = await db
        .selectDistinct({ id: resourceLedger.refId })
        .from(resourceLedger)
        .where(
          and(
            eq(resourceLedger.mapId, mapId),
            eq(resourceLedger.userId, userId),
            eq(resourceLedger.reason, 'village-gift'),
            inArray(resourceLedger.refId, [...communityIds]),
            gte(resourceLedger.createdAt, since),
          ),
        );
      return new Set(rows.flatMap((r) => (r.id === null ? [] : [r.id])));
    },
  };
}

const communityColumns = {
  id: communities.id,
  name: communities.name,
  restoredName: communities.restoredName,
  namedAtLevel: communities.namedAtLevel,
  kind: communities.kind,
  ownerUserId: communities.ownerUserId,
  seedTileId: communities.seedTileId,
  seed: communities.seed,
  keyTileId: communities.keyTileId,
  keyRevealedAt: communities.keyRevealedAt,
};

/** The communities repo inside one transaction, with its events (`maps` last). */
export interface CommunitiesTxRepo extends CommunitiesRepo {
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

/** Runs `fn` in one transaction (restoring and naming, #306 PR 3). */
export function communitiesTransaction<T>(
  db: Executor,
  fn: (repo: CommunitiesTxRepo, tx: Executor) => Promise<T>,
): Promise<T> {
  return withTransaction(db, (tx) =>
    fn({ ...createCommunitiesRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
  );
}
