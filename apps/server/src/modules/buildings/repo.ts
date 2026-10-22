import {
  BuildingKindSchema,
  CLEARED_TERRAIN,
  ElementIdSchema,
  FeelingIdSchema,
  ItemCountsSchema,
  type BuildingRowKind,
  type ElementId,
  type FeelingId,
  type SquishyState,
} from '@heartpatch/shared';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { squishyHouseRoom } from '../house/repo.js';
import { squishyAtWork } from '../jobs/repo.js';
import { squishyOnWatch } from '../territory/repo.js';
import {
  buildings,
  maps,
  packedHomeFires,
  packedCrowdedTiles,
  packedTrainingGrounds,
  squishies,
  tileClears,
  tileExplore,
  tileUseNotes,
  tiles,
} from '../../db/schema.js';

/** One of the player's home tiles (read only: tiles belong to the maps module). */
export interface HomeTileRow {
  id: string;
  q: number;
  r: number;
  nodeResource: string | null;
}

/** A tile a command targets: maybe a home tile, maybe captured land, maybe not mine. */
export interface TargetTileRow extends HomeTileRow {
  ownerUserId: string | null;
  homeSlot: number | null;
  /** A grey village's tile, or a won village's ring (#306). */
  communityId: string | null;
}

export interface BuildingRow {
  id: string;
  mapId: string;
  ownerUserId: string;
  tileId: string;
  q: number;
  r: number;
  /** The tile's home slot: null for captured land outside every home base (#202). */
  homeSlot: number | null;
  buildingId: string;
  kind: BuildingRowKind;
  level: number;
  spot: number;
  /** Last map-local night the fuel covers (`YYYY-MM-DD`); null: never fuelled. */
  fuelledThrough: string | null;
  fuelUpdatedAt: Date | null;
  placedAt: Date;
  /** Resource buildings (#601): where counting output starts; null for other kinds. */
  producedSince: Date | null;
  /** Paused for unpaid upkeep at this morning (#601), or null. */
  pausedAt: Date | null;
  /** The last map-local morning whose upkeep is settled (#601), or null. */
  upkeepPaidThrough: string | null;
  /** The kid's upkeep order (#601 Q5): lower pays first; null for the default. */
  upkeepRank: number | null;
  /** Its owner's homestead flags for the tile (#199), or null when there's no explore row. */
  homestead: { joinedAt: Date | null; pausedAt: Date | null; resumedAt: Date | null } | null;
}

export type NewBuilding = Pick<
  BuildingRow,
  'mapId' | 'ownerUserId' | 'tileId' | 'buildingId' | 'kind' | 'spot'
> & { placedAt: Date; producedSince?: Date | null };

/** What a settle writes back to a resource building (#601); fields left out stay. */
export interface ProductionUpdate {
  producedSince?: Date | null;
  pausedAt?: Date | null;
  upkeepPaidThrough?: string | null;
}

export interface HomeSquishyRow {
  id: string;
  ownerUserId: string;
  speciesId: string;
  element: ElementId;
  feeling: FeelingId;
  nickname: string | null;
  level: number;
  state: SquishyState;
  habitatBuildingId: string | null;
  /** The Training Grounds it practices at, or null (owner decision 2026-10-06). */
  trainingBuildingId: string | null;
}

/** A squishy on the home screen, with what its one job is read from (`jobOf`). */
export interface HomeListRow extends HomeSquishyRow {
  teamSlot: number | null;
  onWatch: boolean;
  atWork: boolean;
  /** The room of its owner's house it lives in (#381, `squishyHouseRoom`), or null. */
  houseRoomId: string | null;
}

/**
 * Building storage (#18). Plain queries; the service decides the rules and
 * runs each command in one transaction. Lock order for every command: the
 * player's home tiles (`lockHomeTiles`), then buildings, then squishies, then
 * inventory rows (`consumeItems` / `grantItems`), then `maps` (the event).
 */
/** A tile as the one-building-per-tile rules read it (#295). */
export interface TileUseTileRow {
  id: string;
  q: number;
  r: number;
  homeSlot: number | null;
  nodeResource: string | null;
  joinedAt: Date | null;
  pausedAt: Date | null;
  resumedAt: Date | null;
  /** The player is clearing it (#242): nothing moves onto it. */
  clearing: boolean;
}

/** The tidy-up note's content (#295), as `tile_use_notes` keeps it. */
export interface TileUseNoteContent {
  moved: { buildingId: string; from: { q: number; r: number }; to: { q: number; r: number } }[];
  packed: { buildingId: string; q: number; r: number }[];
  refund: Record<string, number>;
  stoppedGatherers: { squishyId: string; name: string }[];
}

export type TileUseNote = TileUseNoteContent & { notedAt: Date };

const HexAtSchema = z.object({ q: z.number().int(), r: z.number().int() });
const TileUseNoteSchema = z.object({
  moved: z.array(z.object({ buildingId: z.string(), from: HexAtSchema, to: HexAtSchema })),
  packed: z.array(z.object({ buildingId: z.string(), q: z.number().int(), r: z.number().int() })),
  refund: ItemCountsSchema,
  stoppedGatherers: z.array(z.object({ squishyId: z.string(), name: z.string() })),
});

export interface BuildingsRepo {
  transaction: <T>(fn: (repo: BuildingsTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The player's home tiles (the Heart Seed and its ring), in `q, r` order. */
  listHomeTiles: (mapId: string, userId: string) => Promise<HomeTileRow[]>;
  /**
   * The same tiles, locked until commit (`FOR NO KEY UPDATE`): every
   * building command for one player runs one at a time, so "one Hearthfire
   * per home" and habitat capacity can't race, and the tiles can't change
   * hands meanwhile (a member leaving releases them).
   */
  lockHomeTiles: (mapId: string, userId: string) => Promise<HomeTileRow[]>;
  /**
   * `lockHomeTiles` plus one more tile at `target` (captured land a command
   * builds on, #202), all in one id-ordered lock (tech spec §7 step 6), so a
   * member leaving (every tile, id order) can't deadlock with it.
   */
  lockHomeTilesAnd: (
    mapId: string,
    userId: string,
    target: { q: number; r: number },
  ) => Promise<{ home: HomeTileRow[]; target: TargetTileRow | null }>;
  /** Locks every building on these tiles, in id order (step 8): land changing hands (#202). */
  lockOnTiles: (tileIds: readonly string[]) => Promise<BuildingRow[]>;
  /** Every building's spot, by map, owner and id: the #204 re-layout's scan (no locks). */
  listPlacements: () => Promise<
    {
      id: string;
      mapId: string;
      ownerUserId: string;
      buildingId: string;
      spot: number;
      homeSlot: number | null;
    }[]
  >;
  /**
   * Notes that a player's home fires were packed up (#202): adds `refund` to
   * what the note says came back. Inserted after the bag's rows, before `maps`.
   */
  notePackedFires: (
    mapId: string,
    userId: string,
    refund: Record<string, number>,
    at: Date,
  ) => Promise<void>;
  /**
   * Notes that a player's home Training Grounds packed up and moved out
   * (#277): adds `refund` to what the note says came back. After the bag's
   * rows, before `maps`.
   */
  notePackedTraining: (
    mapId: string,
    userId: string,
    refund: Record<string, number>,
    at: Date,
  ) => Promise<void>;
  /** The player's packed-Training-Grounds note, or null. */
  packedTraining: (
    mapId: string,
    userId: string,
  ) => Promise<{ refund: Record<string, number>; packedAt: Date } | null>;
  /** The player's packed-home-fire note, or null. */
  packedFires: (
    mapId: string,
    userId: string,
  ) => Promise<{ refund: Record<string, number>; packedAt: Date } | null>;
  /**
   * One building per tile (#295): the player's tiles with what the tile-use
   * rules read (home slot, spot, homestead flags from their explore row).
   */
  listTileUseTiles: (mapId: string, userId: string) => Promise<TileUseTileRow[]>;
  /** The player's squishies gathering on any of these tiles, in id order. */
  gatherersOnTiles: (
    mapId: string,
    userId: string,
    tileIds: readonly string[],
  ) => Promise<string[]>;
  /**
   * Players with a building on a tile holding two or more (#295, before
   * migration B's unique index), on every kind of map, by map then player.
   */
  crowdedOwners: () => Promise<{ mapId: string; userId: string }[]>;
  /** Is migration B's unique key on `buildings.tile_id` in (#295)? */
  hasOneBuildingPerTileKey: () => Promise<boolean>;
  /** The tiles where this player has a building and the tile holds two or more, in id order. */
  crowdedTilesOf: (mapId: string, userId: string) => Promise<string[]>;
  /**
   * Notes a player's buildings packed up off crowded tiles (#295): adds
   * `refund` to what the note says came back. After the bag's rows, before `maps`.
   */
  notePackedCrowded: (
    mapId: string,
    userId: string,
    refund: Record<string, number>,
    at: Date,
  ) => Promise<void>;
  /** The player's crowded-tile note, or null. */
  packedCrowded: (
    mapId: string,
    userId: string,
  ) => Promise<{ refund: Record<string, number>; packedAt: Date } | null>;
  /**
   * Every building on a multiplayer map with its tile (for the tidy-up's
   * scan), and the players with a squishy gathering on a tile of theirs out
   * on the land that has a building.
   */
  scanTileUses: () => Promise<{
    rows: { mapId: string; userId: string; tileId: string; buildingId: string; home: boolean }[];
    working: { mapId: string; userId: string }[];
  }>;
  /** The ids of every tile the player owns on the map, in id order. */
  ownedTileIds: (mapId: string, userId: string) => Promise<string[]>;
  /** The player's tidy-up note (#295), or null. JSON is checked on read. */
  tileUseNote: (mapId: string, userId: string) => Promise<TileUseNote | null>;
  /** Writes the player's tidy-up note, replacing any earlier one. After the bag's rows, before `maps`. */
  setTileUseNote: (
    mapId: string,
    userId: string,
    note: TileUseNoteContent,
    at: Date,
  ) => Promise<void>;
  /** Locks all my Hearthfires on this map, in id order (Fuel all fires, #202). */
  lockFires: (mapId: string, userId: string) => Promise<BuildingRow[]>;
  /** The player's buildings on this map, by tile then spot. */
  listOwned: (mapId: string, userId: string) => Promise<BuildingRow[]>;
  /** Every building on the map, on tiles its owner still holds, by tile then spot. */
  listOnMap: (mapId: string) => Promise<BuildingRow[]>;
  lockBuilding: (buildingRowId: string) => Promise<BuildingRow | null>;
  /**
   * A tile's land (#601): its terrain, and for cleared land the terrain its
   * latest finished clear started from (owner decision Q2), else null.
   */
  landOf: (tileId: string) => Promise<{ terrain: string; clearedFrom: string | null } | null>;
  /** Locks the player's buildings that pay upkeep (#601: resource, Warehouse), in id order (step 8). */
  lockUpkeepBuildings: (mapId: string, userId: string) => Promise<BuildingRow[]>;
  /** Writes a resource building's output count and upkeep state (#601). */
  setProduction: (buildingRowId: string, update: ProductionUpdate) => Promise<void>;
  /**
   * Sets the upkeep order (#601 Q5): each id's rank (its index), and null
   * for the player's other upkeep buildings. Lock them first (`lockUpkeepBuildings`).
   */
  setUpkeepRanks: (mapId: string, userId: string, ranked: readonly string[]) => Promise<void>;
  insertBuilding: (building: NewBuilding) => Promise<BuildingRow>;
  moveBuilding: (buildingRowId: string, to: { tileId: string; spot: number }) => Promise<void>;
  setFuel: (buildingRowId: string, fuelledThrough: string, at: Date) => Promise<void>;
  /** Raises a building to `level` (an upgrade). */
  setLevel: (buildingRowId: string, level: number) => Promise<void>;
  deleteBuilding: (buildingRowId: string) => Promise<void>;
  /** Deletes all of a player's buildings on a map (they left); residents move out. */
  deleteOwned: (mapId: string, userId: string) => Promise<number>;

  /**
   * The player's squishies on this map, any state, oldest first, with what
   * their one job reads from (the home's Training Grounds card warns before
   * a Train takes one off watch, work or the team).
   */
  listSquishies: (mapId: string, userId: string) => Promise<HomeListRow[]>;
  /**
   * How many of the player's squishies gather on this tile (#295: a building
   * doesn't go up where one works). Read under the tile's lock, which
   * posting a gatherer takes too.
   */
  gatherersOn: (tileId: string, userId: string) => Promise<number>;
  /** Row-locks a squishy until commit. */
  lockSquishy: (squishyId: string) => Promise<(HomeSquishyRow & { mapId: string }) | null>;
  /**
   * Is the squishy standing watch on its owner's land (decision C, like
   * `isOnWatch`)? Read under the squishy's lock, which posting it locks too.
   */
  isOnWatch: (squishyId: string) => Promise<boolean>;
  /** How many squishies live in a habitat now. */
  countResidents: (buildingRowId: string) => Promise<number>;
  /** Moves a squishy into a habitat (from `at`, for its feeling lean, #32) or out (null). */
  setHabitat: (squishyId: string, habitatBuildingId: string | null, at: Date) => Promise<void>;
  /** Moves everyone out of a habitat; returns who. */
  moveOutAll: (buildingRowId: string) => Promise<string[]>;
  /** Locks the squishies practicing at a Training Grounds, in id order; returns their ids. */
  lockTrainees: (buildingRowId: string) => Promise<string[]>;
  /** The squishies practicing at a Training Grounds, in id order, unlocked (the caller locks them later). */
  traineesOf: (buildingRowId: string) => Promise<string[]>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface BuildingsTxRepo extends BuildingsRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const buildingColumns = {
  id: buildings.id,
  mapId: buildings.mapId,
  ownerUserId: buildings.ownerUserId,
  tileId: buildings.tileId,
  q: tiles.q,
  r: tiles.r,
  homeSlot: tiles.homeSlot,
  buildingId: buildings.buildingId,
  kind: buildings.kind,
  level: buildings.level,
  spot: buildings.spot,
  fuelledThrough: buildings.fuelledThrough,
  fuelUpdatedAt: buildings.fuelUpdatedAt,
  placedAt: buildings.placedAt,
  producedSince: buildings.producedSince,
  pausedAt: buildings.pausedAt,
  upkeepPaidThrough: buildings.upkeepPaidThrough,
  upkeepRank: buildings.upkeepRank,
  homestead: {
    joinedAt: tileExplore.joinedAt,
    pausedAt: tileExplore.pausedAt,
    resumedAt: tileExplore.resumedAt,
  },
};

const squishyColumns = {
  id: squishies.id,
  ownerUserId: squishies.ownerUserId,
  speciesId: squishies.speciesId,
  element: squishies.element,
  feeling: squishies.feeling,
  nickname: squishies.nickname,
  level: squishies.level,
  state: squishies.state,
  habitatBuildingId: squishies.habitatBuildingId,
  trainingBuildingId: squishies.trainingBuildingId,
};

// Text columns are checked on read, so a hand-edited row fails loudly.
const toBuilding = <T extends { kind: string }>(row: T) => ({
  ...row,
  kind: BuildingKindSchema.parse(row.kind),
});
const toSquishy = <T extends { element: string; feeling: string }>(row: T) => ({
  ...row,
  element: ElementIdSchema.parse(row.element),
  feeling: FeelingIdSchema.parse(row.feeling),
});

export function createBuildingsRepo(db: Executor): BuildingsRepo {
  return queries(db);
}

function createBuildingsTxRepo(tx: Transaction): BuildingsTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

/**
 * A first home's tile (#306 PR 3): a won village's ring carries its winner's
 * slot too, with its `community_id`, and takes no buildings yet.
 */
const firstHome = and(isNotNull(tiles.homeSlot), isNull(tiles.communityId));

function queries(db: Executor): BuildingsRepo {
  // The owner's explore row for the tile rides along (a homestead's flags,
  // #199): it's never locked here (`for … of buildings`).
  const selectBuildings = () =>
    db
      .select(buildingColumns)
      .from(buildings)
      .innerJoin(tiles, eq(tiles.id, buildings.tileId))
      .leftJoin(
        tileExplore,
        and(
          eq(tileExplore.tileId, buildings.tileId),
          eq(tileExplore.userId, buildings.ownerUserId),
        ),
      );
  const homeTiles = (mapId: string, userId: string) =>
    db
      .select({ id: tiles.id, q: tiles.q, r: tiles.r, nodeResource: tiles.nodeResource })
      .from(tiles)
      .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId), firstHome))
      .orderBy(asc(tiles.q), asc(tiles.r));

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createBuildingsTxRepo(tx), tx)),

    listHomeTiles: (mapId, userId) => homeTiles(mapId, userId),

    lockHomeTiles: async (mapId, userId) => {
      // Locked in id order (tech spec §7 "Lock order"), returned by (q, r).
      const rows = await db
        .select({ id: tiles.id, q: tiles.q, r: tiles.r, nodeResource: tiles.nodeResource })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId), firstHome))
        .orderBy(asc(tiles.id))
        .for('no key update');
      return rows.sort((a, b) => a.q - b.q || a.r - b.r);
    },

    lockHomeTilesAnd: async (mapId, userId, target) => {
      const rows = await db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          nodeResource: tiles.nodeResource,
          ownerUserId: tiles.ownerUserId,
          homeSlot: tiles.homeSlot,
          communityId: tiles.communityId,
        })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            or(
              and(eq(tiles.ownerUserId, userId), firstHome),
              and(eq(tiles.q, target.q), eq(tiles.r, target.r)),
            ),
          ),
        )
        .orderBy(asc(tiles.id))
        .for('no key update');
      const home = rows
        .filter((t) => t.ownerUserId === userId && t.homeSlot !== null && t.communityId === null)
        .map(({ id, q, r, nodeResource }) => ({ id, q, r, nodeResource }))
        .sort((a, b) => a.q - b.q || a.r - b.r);
      return { home, target: rows.find((t) => t.q === target.q && t.r === target.r) ?? null };
    },

    lockOnTiles: async (tileIds) =>
      tileIds.length === 0
        ? []
        : (
            await selectBuildings()
              .where(inArray(buildings.tileId, [...tileIds]))
              .orderBy(asc(buildings.id))
              .for('update', { of: buildings })
          ).map(toBuilding),

    listPlacements: () =>
      db
        .select({
          id: buildings.id,
          mapId: buildings.mapId,
          ownerUserId: buildings.ownerUserId,
          buildingId: buildings.buildingId,
          spot: buildings.spot,
          homeSlot: tiles.homeSlot,
        })
        .from(buildings)
        .innerJoin(tiles, eq(tiles.id, buildings.tileId))
        .orderBy(asc(buildings.mapId), asc(buildings.ownerUserId), asc(buildings.id)),

    notePackedFires: async (mapId, userId, refund, at) => {
      const [existing] = await db
        .select({ refund: packedHomeFires.refund })
        .from(packedHomeFires)
        .where(and(eq(packedHomeFires.mapId, mapId), eq(packedHomeFires.userId, userId)));
      const sum: Record<string, number> = { ...(existing?.refund ?? {}) };
      for (const [id, n] of Object.entries(refund)) sum[id] = (sum[id] ?? 0) + n;
      await db
        .insert(packedHomeFires)
        .values({ mapId, userId, refund: sum, packedAt: at })
        .onConflictDoUpdate({
          target: [packedHomeFires.mapId, packedHomeFires.userId],
          set: { refund: sum, packedAt: at },
        });
    },

    packedFires: async (mapId, userId) => {
      const [row] = await db
        .select({ refund: packedHomeFires.refund, packedAt: packedHomeFires.packedAt })
        .from(packedHomeFires)
        .where(and(eq(packedHomeFires.mapId, mapId), eq(packedHomeFires.userId, userId)));
      return row ?? null;
    },

    notePackedTraining: async (mapId, userId, refund, at) => {
      const [existing] = await db
        .select({ refund: packedTrainingGrounds.refund })
        .from(packedTrainingGrounds)
        .where(
          and(eq(packedTrainingGrounds.mapId, mapId), eq(packedTrainingGrounds.userId, userId)),
        );
      const sum: Record<string, number> = { ...(existing?.refund ?? {}) };
      for (const [id, n] of Object.entries(refund)) sum[id] = (sum[id] ?? 0) + n;
      await db
        .insert(packedTrainingGrounds)
        .values({ mapId, userId, refund: sum, packedAt: at })
        .onConflictDoUpdate({
          target: [packedTrainingGrounds.mapId, packedTrainingGrounds.userId],
          set: { refund: sum, packedAt: at },
        });
    },

    packedTraining: async (mapId, userId) => {
      const [row] = await db
        .select({
          refund: packedTrainingGrounds.refund,
          packedAt: packedTrainingGrounds.packedAt,
        })
        .from(packedTrainingGrounds)
        .where(
          and(eq(packedTrainingGrounds.mapId, mapId), eq(packedTrainingGrounds.userId, userId)),
        );
      return row ?? null;
    },

    listTileUseTiles: (mapId, userId) =>
      db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          homeSlot: tiles.homeSlot,
          nodeResource: tiles.nodeResource,
          joinedAt: tileExplore.joinedAt,
          pausedAt: tileExplore.pausedAt,
          resumedAt: tileExplore.resumedAt,
          clearing: sql<boolean>`exists (
            select 1 from ${tileClears}
            where ${tileClears.tileId} = ${tiles.id}
              and ${tileClears.userId} = ${userId}
              and ${tileClears.endedAt} is null
          )`,
        })
        .from(tiles)
        .leftJoin(
          tileExplore,
          and(eq(tileExplore.tileId, tiles.id), eq(tileExplore.userId, userId)),
        )
        .where(
          and(
            eq(tiles.mapId, mapId),
            eq(tiles.ownerUserId, userId),
            // A won village's ring (#306 PR 3) takes no buildings yet, so the
            // pass never moves one there.
            or(isNull(tiles.homeSlot), isNull(tiles.communityId)),
          ),
        )
        .orderBy(asc(tiles.id)),

    gatherersOnTiles: async (mapId, userId, tileIds) => {
      if (tileIds.length === 0) return [];
      const rows = await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            inArray(squishies.workTileId, [...tileIds]),
          ),
        )
        .orderBy(asc(squishies.id));
      return rows.map((r) => r.id);
    },

    crowdedOwners: async () => {
      const crowded = db
        .select({ tileId: buildings.tileId })
        .from(buildings)
        .groupBy(buildings.tileId)
        .having(sql`count(*) > 1`);
      return db
        .selectDistinct({ mapId: buildings.mapId, userId: buildings.ownerUserId })
        .from(buildings)
        .where(inArray(buildings.tileId, crowded))
        .orderBy(asc(buildings.mapId), asc(buildings.ownerUserId));
    },

    hasOneBuildingPerTileKey: async () => {
      const [row] = await db.execute<{ found: boolean }>(
        sql`select to_regclass('public.buildings_tile_id_key') is not null as found`,
      );
      return row?.found === true;
    },

    crowdedTilesOf: async (mapId, userId) => {
      const rows = await db
        .select({ tileId: buildings.tileId })
        .from(buildings)
        .where(
          inArray(
            buildings.tileId,
            db
              .select({ tileId: buildings.tileId })
              .from(buildings)
              .where(and(eq(buildings.mapId, mapId), eq(buildings.ownerUserId, userId))),
          ),
        )
        .groupBy(buildings.tileId)
        .having(sql`count(*) > 1`)
        .orderBy(asc(buildings.tileId));
      return rows.map((r) => r.tileId);
    },

    notePackedCrowded: async (mapId, userId, refund, at) => {
      const [existing] = await db
        .select({ refund: packedCrowdedTiles.refund })
        .from(packedCrowdedTiles)
        .where(and(eq(packedCrowdedTiles.mapId, mapId), eq(packedCrowdedTiles.userId, userId)));
      const sum: Record<string, number> = { ...(existing?.refund ?? {}) };
      for (const [id, n] of Object.entries(refund)) sum[id] = (sum[id] ?? 0) + n;
      await db
        .insert(packedCrowdedTiles)
        .values({ mapId, userId, refund: sum, packedAt: at })
        .onConflictDoUpdate({
          target: [packedCrowdedTiles.mapId, packedCrowdedTiles.userId],
          set: { refund: sum, packedAt: at },
        });
    },

    packedCrowded: async (mapId, userId) => {
      const [row] = await db
        .select({ refund: packedCrowdedTiles.refund, packedAt: packedCrowdedTiles.packedAt })
        .from(packedCrowdedTiles)
        .where(and(eq(packedCrowdedTiles.mapId, mapId), eq(packedCrowdedTiles.userId, userId)));
      return row ?? null;
    },

    scanTileUses: async () => {
      const rows = await db
        .select({
          mapId: buildings.mapId,
          userId: buildings.ownerUserId,
          tileId: buildings.tileId,
          buildingId: buildings.buildingId,
          home: sql<boolean>`${tiles.homeSlot} is not null`,
        })
        .from(buildings)
        .innerJoin(tiles, eq(tiles.id, buildings.tileId))
        .innerJoin(maps, eq(maps.id, buildings.mapId))
        .where(eq(maps.kind, 'multiplayer'))
        .orderBy(asc(buildings.mapId), asc(buildings.ownerUserId), asc(buildings.id));
      const working = await db
        .selectDistinct({ mapId: squishies.mapId, userId: squishies.ownerUserId })
        .from(squishies)
        .innerJoin(
          buildings,
          and(
            eq(buildings.tileId, squishies.workTileId),
            eq(buildings.ownerUserId, squishies.ownerUserId),
          ),
        )
        .innerJoin(tiles, eq(tiles.id, buildings.tileId))
        .innerJoin(maps, eq(maps.id, buildings.mapId))
        .where(and(isNull(tiles.homeSlot), eq(maps.kind, 'multiplayer')));
      return { rows, working };
    },

    ownedTileIds: async (mapId, userId) =>
      (
        await db
          .select({ id: tiles.id })
          .from(tiles)
          .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId)))
          .orderBy(asc(tiles.id))
      ).map((t) => t.id),

    tileUseNote: async (mapId, userId) => {
      const [row] = await db
        .select()
        .from(tileUseNotes)
        .where(and(eq(tileUseNotes.mapId, mapId), eq(tileUseNotes.userId, userId)));
      // JSON is checked on read, so a hand-edited row fails loudly.
      return row ? { ...TileUseNoteSchema.parse(row), notedAt: row.notedAt } : null;
    },

    setTileUseNote: async (mapId, userId, note, at) => {
      await db
        .insert(tileUseNotes)
        .values({ mapId, userId, ...note, notedAt: at })
        .onConflictDoUpdate({
          target: [tileUseNotes.mapId, tileUseNotes.userId],
          set: { ...note, notedAt: at, seenAt: null },
        });
    },

    lockFires: async (mapId, userId) =>
      (
        await selectBuildings()
          .where(
            and(
              eq(buildings.mapId, mapId),
              eq(buildings.ownerUserId, userId),
              eq(buildings.kind, 'hearthfire'),
            ),
          )
          .orderBy(asc(buildings.id))
          .for('update', { of: buildings })
      ).map(toBuilding),

    listOwned: async (mapId, userId) =>
      (
        await selectBuildings()
          .where(and(eq(buildings.mapId, mapId), eq(buildings.ownerUserId, userId)))
          .orderBy(asc(tiles.q), asc(tiles.r), asc(buildings.spot))
      ).map(toBuilding),

    listOnMap: async (mapId) =>
      (
        await selectBuildings()
          .where(and(eq(buildings.mapId, mapId), eq(tiles.ownerUserId, buildings.ownerUserId)))
          .orderBy(asc(tiles.q), asc(tiles.r), asc(buildings.spot))
      ).map(toBuilding),

    landOf: async (tileId) => {
      const [row] = await db
        .select({
          terrain: tiles.terrain,
          clearedFrom: sql<string | null>`(
            select ${tileClears.fromTerrain} from ${tileClears}
            where ${tileClears.tileId} = ${tiles.id} and ${tileClears.endReason} = 'cleared'
            order by ${tileClears.endedAt} desc
            limit 1
          )`,
        })
        .from(tiles)
        .where(eq(tiles.id, tileId));
      if (!row) return null;
      return {
        terrain: row.terrain,
        clearedFrom: row.terrain === CLEARED_TERRAIN ? row.clearedFrom : null,
      };
    },

    lockUpkeepBuildings: async (mapId, userId) =>
      (
        await selectBuildings()
          .where(
            and(
              eq(buildings.mapId, mapId),
              eq(buildings.ownerUserId, userId),
              inArray(buildings.kind, ['resource', 'warehouse']),
            ),
          )
          .orderBy(asc(buildings.id))
          .for('update', { of: buildings })
      ).map(toBuilding),

    setProduction: async (buildingRowId, update) => {
      if (Object.keys(update).length === 0) return;
      await db.update(buildings).set(update).where(eq(buildings.id, buildingRowId));
    },

    setUpkeepRanks: async (mapId, userId, ranked) => {
      // Only the rows `lockUpkeepBuildings` holds.
      const owned = and(
        eq(buildings.mapId, mapId),
        eq(buildings.ownerUserId, userId),
        inArray(buildings.kind, ['resource', 'warehouse']),
      );
      await db.update(buildings).set({ upkeepRank: null }).where(owned);
      for (const [rank, id] of ranked.entries()) {
        await db
          .update(buildings)
          .set({ upkeepRank: rank })
          .where(and(owned, eq(buildings.id, id)));
      }
    },

    lockBuilding: async (buildingRowId) => {
      const [row] = await selectBuildings()
        .where(eq(buildings.id, buildingRowId))
        .for('update', { of: buildings });
      return row ? toBuilding(row) : null;
    },

    insertBuilding: async (building) => {
      const [row] = await db.insert(buildings).values(building).returning({ id: buildings.id });
      if (!row) throw new Error('insertBuilding: insert returned no row');
      const [inserted] = await selectBuildings().where(eq(buildings.id, row.id));
      if (!inserted) throw new Error('insertBuilding: building vanished');
      return toBuilding(inserted);
    },

    moveBuilding: async (buildingRowId, to) => {
      await db
        .update(buildings)
        .set({ tileId: to.tileId, spot: to.spot })
        .where(eq(buildings.id, buildingRowId));
    },

    setFuel: async (buildingRowId, fuelledThrough, at) => {
      await db
        .update(buildings)
        .set({ fuelledThrough, fuelUpdatedAt: at })
        .where(eq(buildings.id, buildingRowId));
    },

    setLevel: async (buildingRowId, level) => {
      await db.update(buildings).set({ level }).where(eq(buildings.id, buildingRowId));
    },

    deleteBuilding: async (buildingRowId) => {
      await db.delete(buildings).where(eq(buildings.id, buildingRowId));
    },

    deleteOwned: async (mapId, userId) => {
      const owned = and(eq(buildings.mapId, mapId), eq(buildings.ownerUserId, userId));
      // Tech spec §7 "Lock order": the buildings, then their residents and
      // trainees in id order. Deleting them moves those out through the
      // foreign keys (`ON DELETE SET NULL`), bare multi-row UPDATEs that lock
      // in scan order.
      await db
        .select({ id: buildings.id })
        .from(buildings)
        .where(owned)
        .orderBy(asc(buildings.id))
        .for('update');
      await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(
          or(
            inArray(
              squishies.habitatBuildingId,
              db.select({ id: buildings.id }).from(buildings).where(owned),
            ),
            inArray(
              squishies.trainingBuildingId,
              db.select({ id: buildings.id }).from(buildings).where(owned),
            ),
          ),
        )
        .orderBy(asc(squishies.id))
        .for('no key update');
      // The foreign key clears the habitat; its move-in time goes with it (#32).
      await db
        .update(squishies)
        .set({ habitatSince: null })
        .where(
          inArray(
            squishies.habitatBuildingId,
            db.select({ id: buildings.id }).from(buildings).where(owned),
          ),
        );
      const deleted = await db.delete(buildings).where(owned).returning({ id: buildings.id });
      return deleted.length;
    },

    gatherersOn: async (tileId, userId) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(squishies)
        .where(and(eq(squishies.workTileId, tileId), eq(squishies.ownerUserId, userId)));
      return row?.n ?? 0;
    },

    listSquishies: async (mapId, userId) =>
      (
        await db
          .select({
            ...squishyColumns,
            teamSlot: squishies.teamSlot,
            onWatch: squishyOnWatch(),
            atWork: squishyAtWork(),
            houseRoomId: squishyHouseRoom(),
          })
          .from(squishies)
          .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
          .orderBy(asc(squishies.createdAt), asc(squishies.id))
      ).map(toSquishy),

    lockSquishy: async (squishyId) => {
      const [row] = await db
        .select({ ...squishyColumns, mapId: squishies.mapId })
        .from(squishies)
        .where(eq(squishies.id, squishyId))
        .for('no key update');
      return row ? toSquishy(row) : null;
    },

    isOnWatch: async (squishyId) => {
      const [row] = await db
        .select({ onWatch: squishyOnWatch() })
        .from(squishies)
        .where(eq(squishies.id, squishyId));
      return row?.onWatch ?? false;
    },

    countResidents: async (buildingRowId) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(squishies)
        .where(eq(squishies.habitatBuildingId, buildingRowId));
      return row?.n ?? 0;
    },

    setHabitat: async (squishyId, habitatBuildingId, at) => {
      await db
        .update(squishies)
        .set({ habitatBuildingId, habitatSince: habitatBuildingId === null ? null : at })
        .where(eq(squishies.id, squishyId));
    },

    moveOutAll: async (buildingRowId) => {
      // Lock the residents in id order first, like nightfall (tech spec §7
      // "Lock order"): a bare multi-row UPDATE locks in scan order.
      await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(eq(squishies.habitatBuildingId, buildingRowId))
        .orderBy(asc(squishies.id))
        .for('no key update');
      return (
        await db
          .update(squishies)
          .set({ habitatBuildingId: null, habitatSince: null })
          .where(eq(squishies.habitatBuildingId, buildingRowId))
          .returning({ id: squishies.id })
      )
        .map((r) => r.id)
        .sort();
    },

    lockTrainees: async (buildingRowId) =>
      (
        await db
          .select({ id: squishies.id })
          .from(squishies)
          .where(eq(squishies.trainingBuildingId, buildingRowId))
          .orderBy(asc(squishies.id))
          .for('no key update')
      ).map((r) => r.id),

    traineesOf: async (buildingRowId) =>
      (
        await db
          .select({ id: squishies.id })
          .from(squishies)
          .where(eq(squishies.trainingBuildingId, buildingRowId))
          .orderBy(asc(squishies.id))
      ).map((r) => r.id),
  };
}
