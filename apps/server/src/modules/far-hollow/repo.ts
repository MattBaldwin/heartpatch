import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  farHollowRooms,
  farHollowState,
  gameEvents,
  journeys,
  maps,
  tiles,
} from '../../db/schema.js';

/** My progress through a season's far Hollow (#306 PR 6): its state row. */
export interface FarHollowStateRow {
  keys: number;
  unlocked: number;
  currentRoom: string | null;
  lastLitRoom: string | null;
  bonusOpen: number;
  chestsOpened: number;
  arrivedAt: Date;
  atticOpenedAt: Date | null;
  completedAt: Date | null;
}

/** A room's progress (#306 6b): the things put right (bits, the data's order) and its bloom. */
export interface FarHollowRoomRow {
  roomId: string;
  fixed: number;
  bloomedAt: Date | null;
}

/** What a house command changes on the state row. */
export type FarHollowStatePatch = Partial<
  Pick<
    FarHollowStateRow,
    | 'keys'
    | 'unlocked'
    | 'currentRoom'
    | 'lastLitRoom'
    | 'bonusOpen'
    | 'chestsOpened'
    | 'atticOpenedAt'
    | 'completedAt'
  >
>;

/** Whose far Hollow, in which season (its seed). */
export interface FarHollowKey {
  userId: string;
  mapId: string;
  seasonSeed: string;
}

/**
 * Storage for the far Hollow (#306 PR 6). Plain queries; the service
 * decides. Its rows are tech spec §7 step 6, after `tile_explore`: the
 * season's state row, then its room rows in room id order (#306 6b), and
 * the far road's finish writes the state row after the battle and its
 * `journeys` row (5b).
 */
export interface FarHollowRepo {
  /** The map's secret seed (null on hand-authored maps) and its time zone. Server-only. */
  findMap: (mapId: string) => Promise<{ seed: string | null; timeZone: string } | null>;
  /** My state row for a season's far Hollow (none until I arrive). */
  findState: (key: FarHollowKey) => Promise<FarHollowStateRow | null>;
  /** The same row, row-locked until commit (step 6, first). */
  lockState: (key: FarHollowKey) => Promise<FarHollowStateRow | null>;
  /** Changes my state row (lock it first). */
  setState: (key: FarHollowKey, patch: FarHollowStatePatch) => Promise<void>;
  /** My room rows this season (rooms I've fixed something in). */
  listRooms: (key: FarHollowKey) => Promise<FarHollowRoomRow[]>;
  /**
   * My rows for `roomIds`, made if missing and row-locked until commit, in
   * room id order (step 6, after the state row).
   */
  lockRooms: (key: FarHollowKey, roomIds: readonly string[]) => Promise<FarHollowRoomRow[]>;
  /** Changes a room row (lock it first). */
  setRoom: (key: FarHollowKey, row: FarHollowRoomRow) => Promise<void>;
  /**
   * I arrived in a season's far Hollow: its state row (a row already there
   * stays as it is) and last season's rows gone. True when this was the
   * arrival (no row was there yet).
   */
  arrive: (key: FarHollowKey, at: Date) => Promise<boolean>;
  /**
   * Did I already bring a season's far Hollow all back (`journey.completed`)?
   * Read only on the last step, so it may scan the map's events.
   */
  completedBefore: (
    key: Omit<FarHollowKey, 'seasonSeed'>,
    season: { id: string; year: number },
  ) => Promise<boolean>;
  /** The post my latest won far road set off from, for an event's place on the patch. */
  roadPost: (mapId: string, userId: string) => Promise<{ q: number; r: number } | null>;
}

const stateColumns = {
  keys: farHollowState.keys,
  unlocked: farHollowState.unlocked,
  currentRoom: farHollowState.currentRoom,
  lastLitRoom: farHollowState.lastLitRoom,
  bonusOpen: farHollowState.bonusOpen,
  chestsOpened: farHollowState.chestsOpened,
  arrivedAt: farHollowState.arrivedAt,
  atticOpenedAt: farHollowState.atticOpenedAt,
  completedAt: farHollowState.completedAt,
};

const whereKey = (key: FarHollowKey) =>
  and(
    eq(farHollowState.userId, key.userId),
    eq(farHollowState.mapId, key.mapId),
    eq(farHollowState.seasonSeed, key.seasonSeed),
  );

const roomColumns = {
  roomId: farHollowRooms.roomId,
  fixed: farHollowRooms.fixed,
  bloomedAt: farHollowRooms.bloomedAt,
};

const whereRoomKey = (key: FarHollowKey) =>
  and(
    eq(farHollowRooms.userId, key.userId),
    eq(farHollowRooms.mapId, key.mapId),
    eq(farHollowRooms.seasonSeed, key.seasonSeed),
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

    findState: async (key) => {
      const [row] = await db.select(stateColumns).from(farHollowState).where(whereKey(key));
      return row ?? null;
    },

    lockState: async (key) => {
      const [row] = await db
        .select(stateColumns)
        .from(farHollowState)
        .where(whereKey(key))
        .for('update');
      return row ?? null;
    },

    setState: async (key, patch) => {
      if (Object.keys(patch).length === 0) return;
      await db.update(farHollowState).set(patch).where(whereKey(key));
    },

    listRooms: async (key) =>
      db
        .select(roomColumns)
        .from(farHollowRooms)
        .where(whereRoomKey(key))
        .orderBy(asc(farHollowRooms.roomId)),

    lockRooms: async (key, roomIds) => {
      const ids = [...new Set(roomIds)].sort();
      if (ids.length === 0) return [];
      // Missing rows first (an insert's new rows are its own), then the lock in id order.
      await db
        .insert(farHollowRooms)
        .values(ids.map((roomId) => ({ ...key, roomId })))
        .onConflictDoNothing();
      return db
        .select(roomColumns)
        .from(farHollowRooms)
        .where(and(whereRoomKey(key), inArray(farHollowRooms.roomId, ids)))
        .orderBy(asc(farHollowRooms.roomId))
        .for('update');
    },

    setRoom: async (key, row) => {
      await db
        .update(farHollowRooms)
        .set({ fixed: row.fixed, bloomedAt: row.bloomedAt })
        .where(and(whereRoomKey(key), eq(farHollowRooms.roomId, row.roomId)));
    },

    arrive: async (key, at) => {
      // Last season's rows first (only this player's own commands write them,
      // and a command needs this season's), so the tables keep one season each.
      for (const table of [farHollowRooms, farHollowState]) {
        await db
          .delete(table)
          .where(
            and(
              eq(table.userId, key.userId),
              eq(table.mapId, key.mapId),
              ne(table.seasonSeed, key.seasonSeed),
            ),
          );
      }
      const inserted = await db
        .insert(farHollowState)
        .values({ ...key, arrivedAt: at })
        .onConflictDoNothing()
        .returning({ keys: farHollowState.keys });
      return inserted.length > 0;
    },

    completedBefore: async (key, season) => {
      const [row] = await db
        .select({ id: gameEvents.id })
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.mapId, key.mapId),
            eq(gameEvents.type, 'journey.completed'),
            eq(gameEvents.actorUserId, key.userId),
            sql`${gameEvents.payload}->>'season' = ${season.id}`,
            sql`(${gameEvents.payload}->>'year')::int = ${season.year}`,
          ),
        )
        .limit(1);
      return row !== undefined;
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

/** The repo inside a transaction, which can also append events (`maps` last). */
export type FarHollowTxRepo = FarHollowRepo & {
  appendEvent: (event: NewGameEvent) => Promise<unknown>;
};

/** Runs `fn` in one transaction (a savepoint inside one), with the repo on it. */
export function farHollowTransaction<T>(
  db: Executor,
  fn: (repo: FarHollowTxRepo, tx: Executor) => Promise<T>,
): Promise<T> {
  return withTransaction(db, (tx) =>
    fn({ ...createFarHollowRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
  );
}
