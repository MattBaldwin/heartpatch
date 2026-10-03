import {
  ElementIdSchema,
  FeelingIdSchema,
  type LocalDate,
  type OwnedSquishy,
} from '@heartpatch/shared';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, max, min, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  battles,
  buildings,
  hollowEvents,
  hollowRescues,
  mapMembers,
  maps,
  squishies,
  tileDefenders,
  tiles,
} from '../../db/schema.js';

/** One player's result for a night, as stored in `hollow_events.outcomes` (checked on read). */
const StoredOutcomeSchema = z.strictObject({
  userId: z.uuid(),
  taken: z.uuid().nullable(),
  exposed: z.number().int().min(0),
  sheltered: z.number().int().min(0),
});
export type StoredOutcome = z.infer<typeof StoredOutcomeSchema>;
const StoredOutcomesSchema = z.array(StoredOutcomeSchema);

export interface NightRow {
  id: string;
  night: LocalDate;
  ranAt: Date;
  outcomes: StoredOutcome[];
}

/** A map the nightfall sweep looks at: one with someone playing on it. */
export interface PlayedMapRow {
  id: string;
  timeZone: string;
  /** When its first active member joined (game clock). */
  firstJoinedAt: Date;
  /** The latest night the Hollow Man has come by, or null. */
  lastNight: LocalDate | null;
}

/** A squishy as nightfall needs it: where it sleeps and where it stands watch. */
export interface NightSquishyRow {
  id: string;
  ownerUserId: string;
  state: 'active' | 'hollowed';
  /** Its habitat's tile, or null without one. */
  habitat: { q: number; r: number } | null;
  /** Who owns the tile it stands watch on, if it's posted; `undefined` if it isn't. */
  postOwnerUserId: string | null | undefined;
}

export interface RescueRow {
  id: string;
  mapId: string;
  userId: string;
  squishyId: string;
  battleId: string;
  outcome: 'active' | 'rescued' | 'lost' | 'no-contest';
  /** When its battle ended (game clock), or null while it runs. */
  battleEndedAt: Date | null;
}

/**
 * Storage for the Hollow Man (#21). Plain queries; the service decides the
 * rules and holds the transaction. Nightfall's lock order: the night's
 * `hollow_events` row (the idempotency guard), then squishies, then `maps`
 * (the events, last). A rescue's: the rescue row, the squishy, inventory,
 * found clothing (#43), then `maps`.
 */
export interface HollowRepo {
  transaction: <T>(fn: (repo: HollowTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The map's secret seed (null on hand-authored maps). Server-only. */
  mapSeed: (mapId: string) => Promise<string | null>;
  /** Maps with an active member, with their latest night. */
  playedMaps: () => Promise<PlayedMapRow[]>;
  /**
   * Claims the night for the map: inserts its `hollow_events` row, or returns
   * null if one exists (it ran already). A second run waits here for the
   * first to commit, then gets null.
   */
  claimNight: (mapId: string, night: LocalDate, at: Date) => Promise<string | null>;
  setOutcomes: (nightRowId: string, outcomes: readonly StoredOutcome[]) => Promise<void>;
  /** The map's nights from `since` on, newest first, at most `limit`. */
  nightsSince: (mapId: string, since: LocalDate, limit: number) => Promise<NightRow[]>;

  /** Who plays here now, and when they joined (first-night grace), in user id order. */
  activeMembers: (mapId: string) => Promise<{ userId: string; joinedAt: Date }[]>;
  /** Every home tile with an owner (the Heart Seeds and their rings). */
  homeTiles: (mapId: string) => Promise<{ ownerUserId: string; q: number; r: number }[]>;
  /** Every squishy of an active member, any state, row-locked until commit. */
  nightSquishies: (mapId: string) => Promise<NightSquishyRow[]>;
  /** Moves a squishy to the Hollow if it's still active; false if it wasn't. */
  hollow: (squishyId: string) => Promise<boolean>;
  /** Brings a squishy home from the Hollow; false if it wasn't there. */
  bringHome: (squishyId: string) => Promise<boolean>;

  /** Squishies by id (the morning report's). */
  squishiesById: (ids: readonly string[]) => Promise<OwnedSquishy[]>;
  /** My squishies in the Hollow on this map, oldest first. */
  hollowedOf: (mapId: string, userId: string) => Promise<OwnedSquishy[]>;
  /** Row-locks a squishy until commit. */
  lockSquishy: (squishyId: string) => Promise<OwnedSquishy | null>;
  /** The level of the player's strongest active squishy, or null without one. */
  strongestLevel: (mapId: string, userId: string) => Promise<number | null>;

  insertRescue: (
    rescue: Omit<RescueRow, 'id' | 'outcome' | 'battleEndedAt'> & { startedAt: Date },
  ) => Promise<void>;
  lockRescueByBattle: (battleId: string) => Promise<RescueRow | null>;
  endRescue: (
    rescueId: string,
    outcome: 'rescued' | 'lost' | 'no-contest',
    heartdust: number,
    at: Date,
  ) => Promise<void>;
  /** Rescues that earned Heartdust on this map-local day. */
  rewardedOn: (mapId: string, userId: string, date: LocalDate, timeZone: string) => Promise<number>;
}

export interface HollowTxRepo extends HollowRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const squishyColumns = {
  id: squishies.id,
  mapId: squishies.mapId,
  ownerUserId: squishies.ownerUserId,
  speciesId: squishies.speciesId,
  element: squishies.element,
  feeling: squishies.feeling,
  nickname: squishies.nickname,
  level: squishies.level,
  xp: squishies.xp,
  state: squishies.state,
};

// Content ids are plain text in the database; check them on the way out.
const toOwned = (
  row: Omit<OwnedSquishy, 'element' | 'feeling'> & { element: string; feeling: string },
): OwnedSquishy => ({
  ...row,
  element: ElementIdSchema.parse(row.element),
  feeling: FeelingIdSchema.parse(row.feeling),
});

const rescueColumns = {
  id: hollowRescues.id,
  mapId: hollowRescues.mapId,
  userId: hollowRescues.userId,
  squishyId: hollowRescues.squishyId,
  battleId: hollowRescues.battleId,
  outcome: hollowRescues.outcome,
  battleEndedAt: battles.endedAt,
};

export function createHollowRepo(db: Executor): HollowRepo {
  return queries(db);
}

/** The repo on a consumer's transaction, with `appendEvent`. */
export function createHollowTxRepo(tx: Transaction): HollowTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): HollowRepo {
  const activeMember = and(
    eq(mapMembers.mapId, squishies.mapId),
    eq(mapMembers.userId, squishies.ownerUserId),
    eq(mapMembers.status, 'active'),
  );

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createHollowTxRepo(tx), tx)),

    mapSeed: async (mapId) => {
      const [row] = await db.select({ seed: maps.seed }).from(maps).where(eq(maps.id, mapId));
      return row?.seed ?? null;
    },

    playedMaps: async () => {
      const lastNight = db
        .select({ mapId: hollowEvents.mapId, night: max(hollowEvents.night).as('night') })
        .from(hollowEvents)
        .groupBy(hollowEvents.mapId)
        .as('last_night');
      const played = db
        .select({
          mapId: mapMembers.mapId,
          firstJoinedAt: min(mapMembers.joinedAt).as('first_joined_at'),
        })
        .from(mapMembers)
        .where(eq(mapMembers.status, 'active'))
        .groupBy(mapMembers.mapId)
        .as('played');
      const rows = await db
        .select({
          id: maps.id,
          timeZone: maps.timeZone,
          firstJoinedAt: played.firstJoinedAt,
          lastNight: lastNight.night,
        })
        .from(maps)
        .innerJoin(played, eq(played.mapId, maps.id))
        .leftJoin(lastNight, eq(lastNight.mapId, maps.id))
        .orderBy(asc(maps.id));
      // Aggregates in a subquery may come back as text; `new Date` takes either.
      return rows.flatMap(({ firstJoinedAt, ...row }) =>
        firstJoinedAt === null ? [] : [{ ...row, firstJoinedAt: new Date(firstJoinedAt) }],
      );
    },

    claimNight: async (mapId, night, at) => {
      const [row] = await db
        .insert(hollowEvents)
        .values({ mapId, night, ranAt: at, outcomes: [] })
        .onConflictDoNothing({ target: [hollowEvents.mapId, hollowEvents.night] })
        .returning({ id: hollowEvents.id });
      return row?.id ?? null;
    },

    setOutcomes: async (nightRowId, outcomes) => {
      await db.update(hollowEvents).set({ outcomes }).where(eq(hollowEvents.id, nightRowId));
    },

    nightsSince: async (mapId, since, limit) => {
      const rows = await db
        .select({
          id: hollowEvents.id,
          night: hollowEvents.night,
          ranAt: hollowEvents.ranAt,
          outcomes: hollowEvents.outcomes,
        })
        .from(hollowEvents)
        .where(and(eq(hollowEvents.mapId, mapId), gte(hollowEvents.night, since)))
        .orderBy(desc(hollowEvents.night))
        .limit(limit);
      // jsonb is checked on the way out, so a hand-edited row fails loudly.
      return rows.map((r) => ({ ...r, outcomes: StoredOutcomesSchema.parse(r.outcomes) }));
    },

    activeMembers: (mapId) =>
      db
        .select({ userId: mapMembers.userId, joinedAt: mapMembers.joinedAt })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active')))
        .orderBy(asc(mapMembers.userId)),

    homeTiles: async (mapId) => {
      const rows = await db
        .select({ ownerUserId: tiles.ownerUserId, q: tiles.q, r: tiles.r })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), isNotNull(tiles.homeSlot), isNotNull(tiles.ownerUserId)))
        .orderBy(asc(tiles.q), asc(tiles.r));
      return rows.flatMap((r) => (r.ownerUserId ? [{ ...r, ownerUserId: r.ownerUserId }] : []));
    },

    nightSquishies: async (mapId) => {
      const habitatTile = alias(tiles, 'habitat_tile');
      const postTile = alias(tiles, 'post_tile');
      const rows = await db
        .select({
          id: squishies.id,
          ownerUserId: squishies.ownerUserId,
          state: squishies.state,
          habitatQ: habitatTile.q,
          habitatR: habitatTile.r,
          posted: tileDefenders.squishyId,
          postOwnerUserId: postTile.ownerUserId,
        })
        .from(squishies)
        .innerJoin(mapMembers, activeMember)
        .leftJoin(buildings, eq(buildings.id, squishies.habitatBuildingId))
        .leftJoin(habitatTile, eq(habitatTile.id, buildings.tileId))
        // The post and who holds its tile, not territory's `squishyOnWatch`:
        // shared `shelterOf` decides from them (shared `isOnWatch`, the same
        // rule plus `state`), so nightfall stays a pure step over plain rows.
        .leftJoin(tileDefenders, eq(tileDefenders.squishyId, squishies.id))
        .leftJoin(postTile, eq(postTile.id, tileDefenders.tileId))
        .where(eq(squishies.mapId, mapId))
        .orderBy(asc(squishies.id))
        // Locked until commit, so a squishy can't be moved into or out of a
        // habitat (#18 locks it) between this read and being taken (lock order:
        // the night's row, then squishies). Posting a guard (#15) locks the
        // squishy too, but the joined `tile_defenders` row isn't read again
        // after a lock wait, so a post at the very stroke of nightfall can race.
        .for('update', { of: squishies });
      return rows.map((r) => ({
        id: r.id,
        ownerUserId: r.ownerUserId,
        state: r.state,
        habitat:
          r.habitatQ !== null && r.habitatR !== null ? { q: r.habitatQ, r: r.habitatR } : null,
        postOwnerUserId: r.posted === null ? undefined : r.postOwnerUserId,
      }));
    },

    hollow: async (squishyId) => {
      const rows = await db
        .update(squishies)
        .set({ state: 'hollowed' })
        .where(and(eq(squishies.id, squishyId), eq(squishies.state, 'active')))
        .returning({ id: squishies.id });
      return rows.length > 0;
    },

    bringHome: async (squishyId) => {
      const rows = await db
        .update(squishies)
        .set({ state: 'active' })
        .where(and(eq(squishies.id, squishyId), eq(squishies.state, 'hollowed')))
        .returning({ id: squishies.id });
      return rows.length > 0;
    },

    squishiesById: async (ids) => {
      if (ids.length === 0) return [];
      const rows = await db
        .select(squishyColumns)
        .from(squishies)
        .where(inArray(squishies.id, [...ids]));
      return rows.map(toOwned);
    },

    hollowedOf: async (mapId, userId) => {
      const rows = await db
        .select(squishyColumns)
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'hollowed'),
          ),
        )
        .orderBy(asc(squishies.createdAt), asc(squishies.id));
      return rows.map(toOwned);
    },

    lockSquishy: async (squishyId) => {
      const [row] = await db
        .select(squishyColumns)
        .from(squishies)
        .where(eq(squishies.id, squishyId))
        .for('update');
      return row ? toOwned(row) : null;
    },

    strongestLevel: async (mapId, userId) => {
      const [row] = await db
        .select({ level: max(squishies.level) })
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'active'),
          ),
        );
      return row?.level ?? null;
    },

    insertRescue: async (rescue) => {
      await db.insert(hollowRescues).values(rescue);
    },

    lockRescueByBattle: async (battleId) => {
      const [row] = await db
        .select(rescueColumns)
        .from(hollowRescues)
        .innerJoin(battles, eq(battles.id, hollowRescues.battleId))
        .where(eq(hollowRescues.battleId, battleId))
        .for('update', { of: hollowRescues });
      return row ?? null;
    },

    endRescue: async (rescueId, outcome, heartdust, at) => {
      await db
        .update(hollowRescues)
        .set({ outcome, heartdust, endedAt: at })
        .where(eq(hollowRescues.id, rescueId));
    },

    rewardedOn: async (mapId, userId, date, timeZone) => {
      const [row] = await db
        .select({ n: count() })
        .from(hollowRescues)
        .where(
          and(
            eq(hollowRescues.mapId, mapId),
            eq(hollowRescues.userId, userId),
            gt(hollowRescues.heartdust, 0),
            isNotNull(hollowRescues.endedAt),
            sql`(${hollowRescues.endedAt} at time zone ${timeZone})::date = ${date}::date`,
          ),
        );
      return row?.n ?? 0;
    },
  };
}
