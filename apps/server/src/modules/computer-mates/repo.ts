import { and, asc, count, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { computerMates, mapMembers, maps, tiles, users } from '../../db/schema.js';

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

    /** On the patch (`at`) or off it (null). */
    setNextActAt: async (userId: string, at: Date | null): Promise<void> => {
      await db.update(computerMates).set({ nextActAt: at }).where(eq(computerMates.userId, userId));
    },
  };
}

export type ComputerMatesRepo = ReturnType<typeof createComputerMatesRepo>;
