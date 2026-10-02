import {
  BuildingKindSchema,
  ElementIdSchema,
  FeelingIdSchema,
  type BuildingKind,
  type ElementId,
  type FeelingId,
} from '@heartpatch/shared';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { buildings, squishies, tiles } from '../../db/schema.js';

/** One of the player's home tiles (read only: tiles belong to the maps module). */
export interface HomeTileRow {
  id: string;
  q: number;
  r: number;
  nodeResource: string | null;
}

export interface BuildingRow {
  id: string;
  mapId: string;
  ownerUserId: string;
  tileId: string;
  q: number;
  r: number;
  buildingId: string;
  kind: BuildingKind;
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
  state: 'active' | 'hollowed';
  habitatBuildingId: string | null;
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
  /** The player's buildings on this map, by tile then spot. */
  listOwned: (mapId: string, userId: string) => Promise<BuildingRow[]>;
  /** Every building on the map, on tiles its owner still holds, by tile then spot. */
  listOnMap: (mapId: string) => Promise<BuildingRow[]>;
  lockBuilding: (buildingRowId: string) => Promise<BuildingRow | null>;
  insertBuilding: (building: NewBuilding) => Promise<BuildingRow>;
  moveBuilding: (buildingRowId: string, to: { tileId: string; spot: number }) => Promise<void>;
  setFuel: (buildingRowId: string, fuelledThrough: string, at: Date) => Promise<void>;
  deleteBuilding: (buildingRowId: string) => Promise<void>;
  /** Deletes all of a player's buildings on a map (they left); residents move out. */
  deleteOwned: (mapId: string, userId: string) => Promise<number>;

  /** The player's squishies on this map, any state, oldest first. */
  listSquishies: (mapId: string, userId: string) => Promise<HomeSquishyRow[]>;
  /** Row-locks a squishy until commit. */
  lockSquishy: (squishyId: string) => Promise<(HomeSquishyRow & { mapId: string }) | null>;
  /** How many squishies live in a habitat now. */
  countResidents: (buildingRowId: string) => Promise<number>;
  setHabitat: (squishyId: string, habitatBuildingId: string | null) => Promise<void>;
  /** Moves everyone out of a habitat; returns who. */
  moveOutAll: (buildingRowId: string) => Promise<string[]>;
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

    lockHomeTiles: (mapId, userId) => homeTiles(mapId, userId).for('no key update'),

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

    deleteBuilding: async (buildingRowId) => {
      await db.delete(buildings).where(eq(buildings.id, buildingRowId));
    },

    deleteOwned: async (mapId, userId) => {
      const deleted = await db
        .delete(buildings)
        .where(and(eq(buildings.mapId, mapId), eq(buildings.ownerUserId, userId)))
        .returning({ id: buildings.id });
      return deleted.length;
    },

    listSquishies: async (mapId, userId) =>
      (
        await db
          .select(squishyColumns)
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

    moveOutAll: async (buildingRowId) =>
      (
        await db
          .update(squishies)
          .set({ habitatBuildingId: null })
          .where(eq(squishies.habitatBuildingId, buildingRowId))
          .returning({ id: squishies.id })
      )
        .map((r) => r.id)
        .sort(),
  };
}
