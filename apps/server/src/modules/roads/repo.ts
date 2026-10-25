import { GAME_DATA, type PatchType } from '@heartpatch/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import type { GameEvent } from '../../db/game-events.js';
import { buildings, maps, tileRoads, tiles } from '../../db/schema.js';

/** Content ids of the `travel` buildings with this role. */
export const travelIds = (role: 'bridge' | 'ferry-dock') =>
  GAME_DATA.buildings.flatMap((b) => (b.kind === 'travel' && b.role === role ? [b.id] : []));
/** Bridge content ids (`travel` buildings whose role is `bridge`). */
const BRIDGE_IDS = travelIds('bridge');
/** Ferry dock content ids (W1-5b). */
const DOCK_IDS = travelIds('ferry-dock');

/** A `tile_roads` row with its tile's place and owner now. */
export interface RoadRow {
  tileId: string;
  q: number;
  r: number;
  ownerUserId: string;
  level: number;
  /** Who holds the tile now: a road counts only while that's its owner. */
  tileOwnerUserId: string | null;
}

/** A tile as a road command locks it. */
export interface RoadTileRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
}

/**
 * Storage for Wild Isle roads (#621). Lock order (tech spec §7): a road row
 * is step 6b, after its tile and `tile_explore`, before buildings.
 */
export interface RoadsRepo {
  transaction: <T>(fn: (repo: RoadsTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The map's patch type (`maps.patch_type`); null for a missing map. */
  patchType: (mapId: string) => Promise<PatchType | null>;
  /** Every road on the map whose owner still holds its tile, in (q, r) order. */
  listLive: (mapId: string) => Promise<RoadRow[]>;
  /** Every bridge standing on the map, and whose (`buildings`, kind `travel`). */
  bridges: (mapId: string) => Promise<{ q: number; r: number; ownerUserId: string }[]>;
  /** Every ferry dock standing on the map, and whose (W1-5b). */
  docks: (mapId: string) => Promise<{ q: number; r: number; ownerUserId: string }[]>;
  /** Row-locks a tile by place (`FOR NO KEY UPDATE`, step 6). */
  lockTileAt: (mapId: string, q: number, r: number) => Promise<RoadTileRow | null>;
  /** Row-locks a tile's road (step 6b), stale or live; null with none. */
  lockRoad: (tileId: string) => Promise<RoadRow | null>;
  /** Row-locks the roads on these tiles in tile id order (land lost, step 6b). */
  lockOnTiles: (tileIds: readonly string[]) => Promise<RoadRow[]>;
  insertRoad: (row: {
    tileId: string;
    mapId: string;
    ownerUserId: string;
    level: number;
    builtAt: Date;
  }) => Promise<void>;
  setLevel: (tileId: string, level: number) => Promise<void>;
  deleteRoads: (tileIds: readonly string[]) => Promise<void>;
}

export interface RoadsTxRepo extends RoadsRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const roadColumns = {
  tileId: tileRoads.tileId,
  q: tiles.q,
  r: tiles.r,
  ownerUserId: tileRoads.ownerUserId,
  level: tileRoads.level,
  tileOwnerUserId: tiles.ownerUserId,
};

/** The `travel` buildings of these content ids on a map: where, and whose. */
async function travelOn(db: Executor, mapId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ q: tiles.q, r: tiles.r, ownerUserId: buildings.ownerUserId })
    .from(buildings)
    .innerJoin(tiles, eq(tiles.id, buildings.tileId))
    .where(and(eq(buildings.mapId, mapId), inArray(buildings.buildingId, [...ids])))
    .orderBy(asc(tiles.q), asc(tiles.r));
}

export function createRoadsRepo(db: Executor): RoadsRepo {
  return queries(db);
}

function queries(db: Executor): RoadsRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    patchType: async (mapId) => {
      const [row] = await db
        .select({ patchType: maps.patchType })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row?.patchType ?? null;
    },

    listLive: (mapId) =>
      db
        .select(roadColumns)
        .from(tileRoads)
        .innerJoin(tiles, eq(tiles.id, tileRoads.tileId))
        .where(and(eq(tileRoads.mapId, mapId), eq(tiles.ownerUserId, tileRoads.ownerUserId)))
        .orderBy(asc(tiles.q), asc(tiles.r)),

    bridges: (mapId) => travelOn(db, mapId, BRIDGE_IDS),
    docks: (mapId) => travelOn(db, mapId, DOCK_IDS),

    lockTileAt: async (mapId, q, r) => {
      const [row] = await db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          terrain: tiles.terrain,
          ownerUserId: tiles.ownerUserId,
        })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)))
        .for('no key update');
      return row ?? null;
    },

    lockRoad: async (tileId) => {
      const [row] = await db
        .select(roadColumns)
        .from(tileRoads)
        .innerJoin(tiles, eq(tiles.id, tileRoads.tileId))
        .where(eq(tileRoads.tileId, tileId))
        .for('update', { of: tileRoads });
      return row ?? null;
    },

    lockOnTiles: async (tileIds) => {
      if (tileIds.length === 0) return [];
      return db
        .select(roadColumns)
        .from(tileRoads)
        .innerJoin(tiles, eq(tiles.id, tileRoads.tileId))
        .where(inArray(tileRoads.tileId, [...tileIds]))
        .orderBy(asc(tileRoads.tileId))
        .for('update', { of: tileRoads });
    },

    insertRoad: async (row) => {
      await db.insert(tileRoads).values(row);
    },

    setLevel: async (tileId, level) => {
      await db.update(tileRoads).set({ level }).where(eq(tileRoads.tileId, tileId));
    },

    deleteRoads: async (tileIds) => {
      if (tileIds.length === 0) return;
      await db.delete(tileRoads).where(inArray(tileRoads.tileId, [...tileIds]));
    },
  };
}
