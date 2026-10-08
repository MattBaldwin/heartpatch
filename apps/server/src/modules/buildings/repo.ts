import {
  BuildingKindSchema,
  ElementIdSchema,
  FeelingIdSchema,
  type BuildingRowKind,
  type ElementId,
  type FeelingId,
  type SquishyState,
} from '@heartpatch/shared';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { squishyAtWork } from '../jobs/repo.js';
import { squishyOnWatch } from '../territory/repo.js';
import { buildings, packedHomeFires, squishies, tiles } from '../../db/schema.js';

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
}

export type NewBuilding = Pick<
  BuildingRow,
  'mapId' | 'ownerUserId' | 'tileId' | 'buildingId' | 'kind' | 'spot'
> & { placedAt: Date };

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
}

/**
 * Building storage (#18). Plain queries; the service decides the rules and
 * runs each command in one transaction. Lock order for every command: the
 * player's home tiles (`lockHomeTiles`), then buildings, then squishies, then
 * inventory rows (`consumeItems` / `grantItems`), then `maps` (the event).
 */
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
  /** The player's packed-home-fire note, or null. */
  packedFires: (
    mapId: string,
    userId: string,
  ) => Promise<{ refund: Record<string, number>; packedAt: Date } | null>;
  /** Locks all my Hearthfires on this map, in id order (Fuel all fires, #202). */
  lockFires: (mapId: string, userId: string) => Promise<BuildingRow[]>;
  /** The player's buildings on this map, by tile then spot. */
  listOwned: (mapId: string, userId: string) => Promise<BuildingRow[]>;
  /** Every building on the map, on tiles its owner still holds, by tile then spot. */
  listOnMap: (mapId: string) => Promise<BuildingRow[]>;
  lockBuilding: (buildingRowId: string) => Promise<BuildingRow | null>;
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
  /** Row-locks a squishy until commit. */
  lockSquishy: (squishyId: string) => Promise<(HomeSquishyRow & { mapId: string }) | null>;
  /**
   * Is the squishy standing watch on its owner's land (decision C, like
   * `isOnWatch`)? Read under the squishy's lock, which posting it locks too.
   */
  isOnWatch: (squishyId: string) => Promise<boolean>;
  /** How many squishies live in a habitat now. */
  countResidents: (buildingRowId: string) => Promise<number>;
  setHabitat: (squishyId: string, habitatBuildingId: string | null) => Promise<void>;
  /** Moves everyone out of a habitat; returns who. */
  moveOutAll: (buildingRowId: string) => Promise<string[]>;
  /** Locks the squishies practicing at a Training Grounds, in id order; returns their ids. */
  lockTrainees: (buildingRowId: string) => Promise<string[]>;
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

function queries(db: Executor): BuildingsRepo {
  const selectBuildings = () =>
    db.select(buildingColumns).from(buildings).innerJoin(tiles, eq(tiles.id, buildings.tileId));
  const homeTiles = (mapId: string, userId: string) =>
    db
      .select({ id: tiles.id, q: tiles.q, r: tiles.r, nodeResource: tiles.nodeResource })
      .from(tiles)
      .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId), isNotNull(tiles.homeSlot)))
      .orderBy(asc(tiles.q), asc(tiles.r));

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createBuildingsTxRepo(tx), tx)),

    listHomeTiles: (mapId, userId) => homeTiles(mapId, userId),

    lockHomeTiles: async (mapId, userId) => {
      // Locked in id order (tech spec §7 "Lock order"), returned by (q, r).
      const rows = await db
        .select({ id: tiles.id, q: tiles.q, r: tiles.r, nodeResource: tiles.nodeResource })
        .from(tiles)
        .where(
          and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId), isNotNull(tiles.homeSlot)),
        )
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
        })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            or(
              and(eq(tiles.ownerUserId, userId), isNotNull(tiles.homeSlot)),
              and(eq(tiles.q, target.q), eq(tiles.r, target.r)),
            ),
          ),
        )
        .orderBy(asc(tiles.id))
        .for('no key update');
      const home = rows
        .filter((t) => t.ownerUserId === userId && t.homeSlot !== null)
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
      const deleted = await db.delete(buildings).where(owned).returning({ id: buildings.id });
      return deleted.length;
    },

    listSquishies: async (mapId, userId) =>
      (
        await db
          .select({
            ...squishyColumns,
            teamSlot: squishies.teamSlot,
            onWatch: squishyOnWatch(),
            atWork: squishyAtWork(),
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

    setHabitat: async (squishyId, habitatBuildingId) => {
      await db.update(squishies).set({ habitatBuildingId }).where(eq(squishies.id, squishyId));
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
          .set({ habitatBuildingId: null })
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
  };
}
