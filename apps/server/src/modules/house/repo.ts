import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { houseResidents, keeperHouses, squishies, squishyEvolutions } from '../../db/schema.js';

/** One resident as the house and the progress facts read it. */
export interface ResidentRow {
  squishyId: string;
  roomId: string;
  movedInAt: Date;
  level: number;
  state: 'active' | 'hollowed' | 'in-trade';
  /** It has evolved at least once on this patch. */
  evolved: boolean;
}

/**
 * The Keeper's house rows (#381). Lock order (tech spec §7): `keeper_houses`
 * is step 8c, after buildings, fence segments, the craft and the Factory's
 * batches (8), before the Hollow's rows (9). `house_residents` rows are
 * never locked on their own: every writer holds the squishy's lock (step 10).
 */
export interface HouseRepo {
  /** Runs `fn` in one transaction, with a repo that can also append events. */
  transaction: <T>(fn: (repo: HouseTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The built level, or null when there's no row yet (level 1). A plain read. */
  level: (mapId: string, userId: string) => Promise<number | null>;
  /** Built levels for several Keepers on a patch (no row: left out). A plain read. */
  levels: (mapId: string, userIds: readonly string[]) => Promise<Map<string, number>>;
  /**
   * Locks the Keeper's house row (`FOR UPDATE`, step 8c), inserting it at
   * `startLevel` first when there's none, and returns its level. One build at
   * a time per house, and the level read under it is the truth.
   */
  lockHouse: (mapId: string, userId: string, startLevel: number, at: Date) => Promise<number>;
  /** Writes a new level on a house row already locked by this transaction. */
  setLevel: (mapId: string, userId: string, level: number, at: Date) => Promise<void>;
  /** The Keeper's residents now (room set), whatever their state. A plain read. */
  residents: (mapId: string, userId: string) => Promise<ResidentRow[]>;
  /**
   * Squishies the player owns on this patch that have a residency row (in
   * or moved out), unlocked: the caller locks them (step 10) before
   * `deleteResidents`. Keyed by the squishy's owner, not the row's
   * `user_id`, so a traded squishy's row is never the old owner's to delete.
   */
  residentSquishyIds: (mapId: string, userId: string) => Promise<string[]>;
  /** Deletes these squishies' residency rows; the caller holds their locks (step 10). */
  deleteResidents: (squishyIds: readonly string[]) => Promise<void>;
  /**
   * A member left or was removed: their house goes with their buildings (a
   * returning player gets a fresh home), its gifts by cascade. Step 8c.
   */
  deleteHouse: (mapId: string, userId: string) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface HouseTxRepo extends HouseRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

function createHouseTxRepo(tx: Transaction): HouseTxRepo {
  return { ...createHouseRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

export function createHouseRepo(db: Executor): HouseRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createHouseTxRepo(tx), tx)),

    level: async (mapId, userId) => {
      const [row] = await db
        .select({ level: keeperHouses.level })
        .from(keeperHouses)
        .where(and(eq(keeperHouses.mapId, mapId), eq(keeperHouses.userId, userId)));
      return row?.level ?? null;
    },

    levels: async (mapId, userIds) => {
      if (userIds.length === 0) return new Map();
      const rows = await db
        .select({ userId: keeperHouses.userId, level: keeperHouses.level })
        .from(keeperHouses)
        .where(and(eq(keeperHouses.mapId, mapId), inArray(keeperHouses.userId, [...userIds])));
      return new Map(rows.map((r) => [r.userId, r.level]));
    },

    lockHouse: async (mapId, userId, startLevel, at) => {
      await db
        .insert(keeperHouses)
        .values({ mapId, userId, level: startLevel, builtAt: at, updatedAt: at })
        .onConflictDoNothing();
      const [row] = await db
        .select({ level: keeperHouses.level })
        .from(keeperHouses)
        .where(and(eq(keeperHouses.mapId, mapId), eq(keeperHouses.userId, userId)))
        .for('update');
      if (!row) throw new Error('lockHouse: the house row is missing after its insert');
      return row.level;
    },

    setLevel: async (mapId, userId, level, at) => {
      await db
        .update(keeperHouses)
        .set({ level, builtAt: at, updatedAt: at })
        .where(and(eq(keeperHouses.mapId, mapId), eq(keeperHouses.userId, userId)));
    },

    residents: (mapId, userId) =>
      db
        .select({
          squishyId: houseResidents.squishyId,
          roomId: houseResidents.roomId,
          movedInAt: houseResidents.movedInAt,
          level: squishies.level,
          state: squishies.state,
          evolved: sql<boolean>`exists (select 1 from ${squishyEvolutions} where ${squishyEvolutions.squishyId} = ${houseResidents.squishyId})`,
        })
        .from(houseResidents)
        .innerJoin(squishies, eq(squishies.id, houseResidents.squishyId))
        .where(
          and(
            eq(houseResidents.mapId, mapId),
            eq(houseResidents.userId, userId),
            isNotNull(houseResidents.roomId),
            // Only squishies the Keeper still owns on this patch.
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
          ),
        )
        .then((rows) =>
          rows.flatMap((r) =>
            r.roomId !== null && r.movedInAt !== null
              ? [{ ...r, roomId: r.roomId, movedInAt: r.movedInAt, evolved: r.evolved }]
              : [],
          ),
        ),

    residentSquishyIds: (mapId, userId) =>
      db
        .select({ id: houseResidents.squishyId })
        .from(houseResidents)
        .innerJoin(squishies, eq(squishies.id, houseResidents.squishyId))
        .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
        .then((rows) => rows.map((r) => r.id)),

    deleteResidents: async (squishyIds) => {
      if (squishyIds.length === 0) return;
      await db.delete(houseResidents).where(inArray(houseResidents.squishyId, [...squishyIds]));
    },

    deleteHouse: async (mapId, userId) => {
      await db
        .delete(keeperHouses)
        .where(and(eq(keeperHouses.mapId, mapId), eq(keeperHouses.userId, userId)));
    },
  };
}
