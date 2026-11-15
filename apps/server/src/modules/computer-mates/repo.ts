import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { computerMates, mapMembers, maps, squishies, tiles, users } from '../../db/schema.js';

/*
 * Real Keepers only (#386). A computer patch-mate is a `users` row with
 * `kind = 'computer'`: it owns land, squishies and a seat, but it never logs
 * in, gets a push, wears a title or crown, or counts as a Keeper for seats or
 * the Long Night. Every such rule reads `playerUser` (or `computerIds`), so
 * "real" means one thing.
 */

/** `users.kind = 'player'`: add to any query that must see real kids only. */
export const playerUser: SQL = eq(users.kind, 'player');

/** `maps.id = mapId`, for tests that reshape a patch (as maps' `activeMember`). */
export const mapIs = (mapId: string): SQL => eq(maps.id, mapId);

/** One mate step's transaction (#386c): modules reach the client through their repo. */
export const mateTransaction = <T>(db: Executor, fn: (tx: Transaction) => Promise<T>) =>
  withTransaction(db, fn);

/** A computer patch-mate's own row (#386), with whether it's on the patch now. */
export interface MateRow {
  userId: string;
  personaId: string;
  seed: string;
  /** Holds an active `map_members` row on this patch. */
  active: boolean;
  /** Tiles it owns on the patch (its home ring included). */
  tiles: number;
}

/** A mate's row, locked for one step (#386c). */
export interface MateStepRow {
  userId: string;
  mapId: string;
  personaId: string;
  seed: string;
  step: number;
  /** Null: off the patch (departed, or the switch is off). */
  nextActAt: Date | null;
  state: MateState;
}

/** Per-behaviour stamps in `computer_mates.state` (#386c; 386d/e add theirs). */
export interface MateState {
  /** The patch day `claims` counts. */
  claimDay?: string;
  claims?: number;
  /** Quiet steps left after a kid came back (rule C). */
  catchUpLeft?: number;
}

export interface SwitchRow {
  computerMates: boolean;
  computerMatesChangedAt: Date | null;
}

/**
 * Computer patch-mates' rows. Lock order (tech spec §7): a patch's
 * `computer_mates` rows are taken right after the seats lock (step 3a, user
 * id order), before a join request, `users` or anything later.
 */
export function createComputerMatesRepo(db: Executor) {
  return {
    /** Step 3a: every mate row on the patch, in user id order. */
    lockMates: async (mapId: string): Promise<void> => {
      await db
        .select({ userId: computerMates.userId })
        .from(computerMates)
        .where(eq(computerMates.mapId, mapId))
        .orderBy(asc(computerMates.userId))
        .for('update');
    },

    /** The patch's mates, every persona ever made here, with land counts. */
    listMates: async (mapId: string): Promise<MateRow[]> => {
      const rows = await db
        .select({
          userId: computerMates.userId,
          personaId: computerMates.personaId,
          seed: computerMates.seed,
          status: mapMembers.status,
          tiles: sql<number>`(
            select count(*)::int from ${tiles} as t
            where t.map_id = ${computerMates.mapId} and t.owner_user_id = ${computerMates.userId}
          )`,
        })
        .from(computerMates)
        .leftJoin(
          mapMembers,
          and(
            eq(mapMembers.mapId, computerMates.mapId),
            eq(mapMembers.userId, computerMates.userId),
          ),
        )
        .where(eq(computerMates.mapId, mapId))
        .orderBy(asc(computerMates.createdAt), asc(computerMates.userId));
      return rows.map(({ status, ...row }) => ({ ...row, active: status === 'active' }));
    },

    /** Real Keepers (not computer mates) holding a seat on the patch. */
    countActivePlayers: async (mapId: string): Promise<number> => {
      const [row] = await db
        .select({ n: count() })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active'), playerUser));
      return row?.n ?? 0;
    },

    /** Ids of the real Keepers holding a seat on the patch. */
    activePlayerIds: async (mapId: string): Promise<Set<string>> => {
      const rows = await db
        .select({ id: users.id })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active'), playerUser));
      return new Set(rows.map((r) => r.id));
    },

    /** Lower-cased usernames of the real Keepers holding a seat on the patch. */
    activePlayerNames: async (mapId: string): Promise<Set<string>> => {
      const rows = await db
        .select({ username: users.username })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active'), playerUser));
      return new Set(rows.map((r) => r.username.toLowerCase()));
    },

    /** Which of `userIds` are computer mates (any patch). */
    computerIds: async (userIds: readonly string[]): Promise<Set<string>> => {
      if (userIds.length === 0) return new Set();
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, [...userIds]), eq(users.kind, 'computer')));
      return new Set(rows.map((r) => r.id));
    },

    /** Persona per mate user id on the patch (for `MapMember.computer`). */
    personasOn: async (mapId: string): Promise<Map<string, string>> => {
      const rows = await db
        .select({ userId: computerMates.userId, personaId: computerMates.personaId })
        .from(computerMates)
        .where(eq(computerMates.mapId, mapId));
      return new Map(rows.map((r) => [r.userId, r.personaId]));
    },

    switchOf: async (mapId: string): Promise<SwitchRow | null> => {
      const [row] = await db
        .select({
          computerMates: maps.computerMates,
          computerMatesChangedAt: maps.computerMatesChangedAt,
        })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row ?? null;
    },

    /** Step 13 (`maps`, last but for the event append that follows). */
    setSwitch: async (mapId: string, enabled: boolean, at: Date): Promise<void> => {
      await db
        .update(maps)
        .set({ computerMates: enabled, computerMatesChangedAt: at })
        .where(eq(maps.id, mapId));
    },

    /** Makes the persona's `users` row and its `computer_mates` row. */
    insertMate: async (input: {
      mapId: string;
      personaId: string;
      username: string;
      timeZone: string;
      seed: string;
    }): Promise<string> => {
      const [user] = await db
        .insert(users)
        .values({ username: input.username, kind: 'computer', timeZone: input.timeZone })
        .returning({ id: users.id });
      if (!user) throw new Error('insertMate: insert returned no row');
      await db.insert(computerMates).values({
        userId: user.id,
        mapId: input.mapId,
        personaId: input.personaId,
        seed: input.seed,
      });
      return user.id;
    },

    /**
     * Step 3a for one mate's step (#386c): its own row, `FOR UPDATE`. Never
     * after a tile, building or squishy lock (tech spec §7).
     */
    lockMate: async (userId: string): Promise<MateStepRow | null> => {
      const [row] = await db
        .select({
          userId: computerMates.userId,
          mapId: computerMates.mapId,
          personaId: computerMates.personaId,
          seed: computerMates.seed,
          step: computerMates.step,
          nextActAt: computerMates.nextActAt,
          state: computerMates.state,
        })
        .from(computerMates)
        .where(eq(computerMates.userId, userId))
        .for('update');
      return row ? { ...row, state: row.state } : null;
    },

    /**
     * Mates due a step (`next_act_at <= at`) on patches with the switch on
     * that a real member opened since `warmSince` (rule C). A patch nobody
     * opened is never selected.
     */
    dueMates: async (
      at: Date,
      warmSince: Date,
      limit: number,
    ): Promise<{ userId: string; step: number }[]> =>
      db
        .select({ userId: computerMates.userId, step: computerMates.step })
        .from(computerMates)
        .innerJoin(maps, eq(maps.id, computerMates.mapId))
        .where(
          and(
            isNotNull(computerMates.nextActAt),
            lte(computerMates.nextActAt, at),
            eq(maps.computerMates, true),
            gt(maps.keepersSeenAt, warmSince),
          ),
        )
        .orderBy(asc(computerMates.nextActAt), asc(computerMates.userId))
        .limit(limit),

    /** Patches with mates due a step that nobody has opened since `warmSince`. */
    coldDueMaps: async (at: Date, warmSince: Date): Promise<string[]> => {
      const rows = await db
        .selectDistinct({ mapId: computerMates.mapId })
        .from(computerMates)
        .innerJoin(maps, eq(maps.id, computerMates.mapId))
        .where(
          and(
            isNotNull(computerMates.nextActAt),
            lte(computerMates.nextActAt, at),
            eq(maps.computerMates, true),
            or(isNull(maps.keepersSeenAt), lte(maps.keepersSeenAt, warmSince)),
          ),
        );
      return rows.map((r) => r.mapId);
    },

    /** A real member has the patch open (`maps.keepers_seen_at`; a plain write, no lock). */
    stampSeen: async (mapId: string, at: Date): Promise<void> => {
      await db
        .update(maps)
        .set({
          keepersSeenAt: sql`greatest(${maps.keepersSeenAt}, ${at.toISOString()}::timestamptz)`,
        })
        .where(eq(maps.id, mapId));
    },

    /** Ends a step: the next step number, when it's due, and the stamps. */
    advance: async (
      userId: string,
      step: number,
      nextActAt: Date,
      state: MateState,
    ): Promise<void> => {
      await db
        .update(computerMates)
        .set({ step, nextActAt, state: state as Record<string, unknown> })
        .where(eq(computerMates.userId, userId));
    },

    /**
     * Step 10: sets every one of the mate's squishies on the patch to
     * `level` (set, not earned; plan §1 D). Returns how many changed.
     */
    setTeamLevel: async (mapId: string, userId: string, level: number): Promise<number> => {
      const locked = await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            ne(squishies.level, level),
          ),
        )
        .orderBy(asc(squishies.id))
        .for('update');
      if (locked.length === 0) return 0;
      await db
        .update(squishies)
        .set({ level, xp: 0 })
        .where(
          inArray(
            squishies.id,
            locked.map((r) => r.id),
          ),
        );
      return locked.length;
    },

    /** The mate's active squishies on the patch, in id order (guards come from these). */
    teamOf: async (mapId: string, userId: string): Promise<{ id: string; state: string }[]> =>
      db
        .select({ id: squishies.id, state: squishies.state })
        .from(squishies)
        .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
        .orderBy(asc(squishies.id)),

    /** Step 10: the mate's squishies on the patch, `FOR UPDATE` in id order. */
    lockTeam: async (mapId: string, userId: string): Promise<{ id: string; state: string }[]> =>
      db
        .select({ id: squishies.id, state: squishies.state })
        .from(squishies)
        .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
        .orderBy(asc(squishies.id))
        .for('update'),

    /** On the patch (`at`) or off it (null). */
    setNextActAt: async (userId: string, at: Date | null): Promise<void> => {
      await db.update(computerMates).set({ nextActAt: at }).where(eq(computerMates.userId, userId));
    },
  };
}

export type ComputerMatesRepo = ReturnType<typeof createComputerMatesRepo>;
