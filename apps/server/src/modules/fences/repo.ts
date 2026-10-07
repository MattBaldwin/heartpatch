import { and, asc, eq, inArray } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { fenceSegments, tiles } from '../../db/schema.js';

/** A fence segment (#203) with its tile. */
export interface FenceRow {
  id: string;
  mapId: string;
  ownerUserId: string;
  tileId: string;
  q: number;
  r: number;
  edge: number;
  buildingId: string;
  level: number;
  hp: number;
  builtAt: Date;
}

/** The tile a fence command targets, locked. */
export interface FenceTileRow {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  homeSlot: number | null;
}

export type NewFence = Pick<
  FenceRow,
  'mapId' | 'ownerUserId' | 'tileId' | 'edge' | 'buildingId' | 'hp' | 'builtAt'
>;

/**
 * Fence storage (#203). Plain queries; the service decides the rules. Lock
 * order (tech spec §7): the tile (step 6), then its segments (step 8, with
 * the buildings), then inventory rows, then `maps` (the event).
 */
export interface FencesRepo {
  transaction: <T>(fn: (repo: FencesTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The tile at `q, r` on this map, locked (`FOR NO KEY UPDATE`, like building on it). */
  lockTileAt: (mapId: string, q: number, r: number) => Promise<FenceTileRow | null>;
  /** The same, by id. */
  lockTile: (tileId: string) => Promise<FenceTileRow | null>;
  findFence: (fenceId: string) => Promise<FenceRow | null>;
  lockFence: (fenceId: string) => Promise<FenceRow | null>;
  /** A tile's segments, in edge order (no locks). */
  listOnTile: (tileId: string) => Promise<FenceRow[]>;
  /** Locks every segment on these tiles, in id order (step 8): land changing hands. */
  lockOnTiles: (tileIds: readonly string[]) => Promise<FenceRow[]>;
  /** Every segment on the map, by tile then edge (the map view). */
  listOnMap: (mapId: string) => Promise<FenceRow[]>;
  /** A player's segments on this map, by tile then edge. */
  listOwned: (mapId: string, userId: string) => Promise<FenceRow[]>;
  insertFence: (fence: NewFence) => Promise<FenceRow>;
  setLevelAndHp: (fenceId: string, level: number, hp: number) => Promise<void>;
  setHp: (fenceId: string, hp: number) => Promise<void>;
  deleteFence: (fenceId: string) => Promise<void>;
  /** Deletes these segments (already locked, step 8). */
  deleteFences: (fenceIds: readonly string[]) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface FencesTxRepo extends FencesRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const fenceColumns = {
  id: fenceSegments.id,
  mapId: fenceSegments.mapId,
  ownerUserId: fenceSegments.ownerUserId,
  tileId: fenceSegments.tileId,
  q: tiles.q,
  r: tiles.r,
  edge: fenceSegments.edge,
  buildingId: fenceSegments.buildingId,
  level: fenceSegments.level,
  hp: fenceSegments.hp,
  builtAt: fenceSegments.builtAt,
};

const tileColumns = {
  id: tiles.id,
  q: tiles.q,
  r: tiles.r,
  ownerUserId: tiles.ownerUserId,
  homeSlot: tiles.homeSlot,
};

export function createFencesRepo(db: Executor): FencesRepo {
  return queries(db);
}

function createFencesTxRepo(tx: Transaction): FencesTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): FencesRepo {
  const selectFences = () =>
    db
      .select(fenceColumns)
      .from(fenceSegments)
      .innerJoin(tiles, eq(tiles.id, fenceSegments.tileId));

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createFencesTxRepo(tx), tx)),

    lockTileAt: async (mapId, q, r) => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)))
        .for('no key update');
      return row ?? null;
    },

    lockTile: async (tileId) => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(eq(tiles.id, tileId))
        .for('no key update');
      return row ?? null;
    },

    findFence: async (fenceId) => {
      const [row] = await selectFences().where(eq(fenceSegments.id, fenceId));
      return row ?? null;
    },

    lockFence: async (fenceId) => {
      const [row] = await selectFences()
        .where(eq(fenceSegments.id, fenceId))
        .for('update', { of: fenceSegments });
      return row ?? null;
    },

    listOnTile: (tileId) =>
      selectFences().where(eq(fenceSegments.tileId, tileId)).orderBy(asc(fenceSegments.edge)),

    lockOnTiles: async (tileIds) =>
      tileIds.length === 0
        ? []
        : selectFences()
            .where(inArray(fenceSegments.tileId, [...tileIds]))
            .orderBy(asc(fenceSegments.id))
            .for('update', { of: fenceSegments }),

    listOnMap: (mapId) =>
      selectFences()
        .where(eq(fenceSegments.mapId, mapId))
        .orderBy(asc(tiles.q), asc(tiles.r), asc(fenceSegments.edge)),

    listOwned: (mapId, userId) =>
      selectFences()
        .where(and(eq(fenceSegments.mapId, mapId), eq(fenceSegments.ownerUserId, userId)))
        .orderBy(asc(tiles.q), asc(tiles.r), asc(fenceSegments.edge)),

    insertFence: async (fence) => {
      const [inserted] = await db
        .insert(fenceSegments)
        .values({ ...fence, level: 1 })
        .returning({ id: fenceSegments.id });
      if (!inserted) throw new Error('insertFence: no row');
      const [row] = await selectFences().where(eq(fenceSegments.id, inserted.id));
      if (!row) throw new Error('insertFence: row vanished');
      return row;
    },

    setLevelAndHp: async (fenceId, level, hp) => {
      await db.update(fenceSegments).set({ level, hp }).where(eq(fenceSegments.id, fenceId));
    },

    setHp: async (fenceId, hp) => {
      await db.update(fenceSegments).set({ hp }).where(eq(fenceSegments.id, fenceId));
    },

    deleteFence: async (fenceId) => {
      await db.delete(fenceSegments).where(eq(fenceSegments.id, fenceId));
    },

    deleteFences: async (fenceIds) => {
      if (fenceIds.length === 0) return;
      await db.delete(fenceSegments).where(inArray(fenceSegments.id, [...fenceIds]));
    },
  };
}
