import {
  ElementIdSchema,
  FeelingIdSchema,
  HollowStageSchema,
  WalkKindSchema,
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
  fenceSegments,
  hollowEvents,
  hollowRescues,
  mapMembers,
  maps,
  squishies,
  tileAttacks,
  tileDefenders,
  tiles,
  tileTending,
} from '../../db/schema.js';
import { squishyAtWork } from '../jobs/repo.js';
import { activeMember } from '../maps/repo.js';

const coords = z.strictObject({ q: z.number().int(), r: z.number().int() });

/**
 * One player's result for a night, as stored in `hollow_events.outcomes`
 * (checked on read). Nights before #277 stored one `taken` id or null and
 * none of the walk; they read back as a list and an empty walk.
 */
const StoredOutcomeSchema = z.strictObject({
  userId: z.uuid(),
  taken: z
    .union([z.array(z.uuid()), z.uuid().nullable()])
    .transform((t) => (Array.isArray(t) ? t : t === null ? [] : [t])),
  exposed: z.number().int().min(0),
  sheltered: z.number().int().min(0),
  /** The Keeper's night on the patch (#277), and how many strikes it rolled. */
  keeperNight: z.number().int().optional(),
  strikes: z.number().int().min(0).optional(),
  stage: HollowStageSchema.optional(),
  /** Dark tiles he won back (applied by the night's reclaim step). */
  reclaimed: z.array(coords).optional(),
  walk: z
    .array(
      z.strictObject({
        q: z.number().int(),
        r: z.number().int(),
        kind: WalkKindSchema,
      }),
    )
    .optional(),
  /** What stood on the land he won back. */
  lostBuildings: z
    .strictObject({
      fires: z.number().int().min(0),
      fences: z.number().int().min(0),
      trainingGrounds: z.number().int().min(0),
    })
    .optional(),
});
export type StoredOutcome = z.output<typeof StoredOutcomeSchema>;
const StoredOutcomesSchema = z.array(StoredOutcomeSchema);

/** A tile as the Hollow Man's night needs it (#277). */
export interface NightTileRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  nodeResource: string | null;
  /** When its owner claimed it (null: before #277, or never claimed). */
  claimedAt: Date | null;
}

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
  /** Where it stands watch (it spends the night there), or null if it isn't posted. */
  post: { q: number; r: number } | null;
  /** The tile it works as a gatherer (it spends the night there), or null. */
  work: { q: number; r: number } | null;
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
  /** Patches (not the Glade, #24) with an active member, with their latest night. */
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
  /** One night's row, or null if it hasn't run. */
  nightOf: (mapId: string, night: LocalDate) => Promise<NightRow | null>;
  /** Every tile on the map, with when its owner claimed it (#277). */
  nightTiles: (mapId: string) => Promise<NightTileRow[]>;
  /** Tiles still cooling down after a battle at `at` (a tile in a fight isn't won back). */
  coolingTiles: (mapId: string, at: Date) => Promise<Set<string>>;
  /** Fence segments standing on each of these tiles, by tile id. */
  fencesOn: (tileIds: readonly string[]) => Promise<Map<string, number>>;
  /** The patch's "Hollow Man strength" percent (#277, admin console). */
  strengthPercent: (mapId: string) => Promise<number>;
  /** Every home tile with an owner (the Heart Seeds and their rings). */
  homeTiles: (mapId: string) => Promise<{ ownerUserId: string; q: number; r: number }[]>;
  /**
   * Locks every tile someone stands watch on (step 6, id order, `FOR NO KEY
   * UPDATE`), before `nightSquishies`' squishy locks, so a guard taken to the
   * Hollow can leave its post the way posting writes it: under its tile's lock.
   */
  lockPostTiles: (mapId: string) => Promise<void>;
  /**
   * Every squishy of an active member, any state, row-locked until commit
   * (nightfall). `lock: false` only reads (the hollow status's nudge): a read
   * endpoint never waits on or blocks a command's squishy locks.
   */
  nightSquishies: (mapId: string, options?: { lock?: boolean }) => Promise<NightSquishyRow[]>;
  /** Takes these squishies off watch (`tile_defenders`); after `lockPostTiles`. */
  leavePosts: (squishyIds: readonly string[]) => Promise<void>;
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
        // The Tutorial Glade's night is scripted (its own step, #24): the
        // sweep skips it, so a finished Glade never gets a night again.
        .where(eq(maps.kind, 'multiplayer'))
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

    nightOf: async (mapId, night) => {
      const [row] = await db
        .select({
          id: hollowEvents.id,
          night: hollowEvents.night,
          ranAt: hollowEvents.ranAt,
          outcomes: hollowEvents.outcomes,
        })
        .from(hollowEvents)
        .where(and(eq(hollowEvents.mapId, mapId), eq(hollowEvents.night, night)));
      return row ? { ...row, outcomes: StoredOutcomesSchema.parse(row.outcomes) } : null;
    },

    nightTiles: (mapId) =>
      db
        .select({
          id: tiles.id,
          q: tiles.q,
          r: tiles.r,
          terrain: tiles.terrain,
          ownerUserId: tiles.ownerUserId,
          homeSlot: tiles.homeSlot,
          nodeResource: tiles.nodeResource,
          claimedAt: tileTending.claimedAt,
        })
        .from(tiles)
        .leftJoin(tileTending, eq(tileTending.tileId, tiles.id))
        .where(eq(tiles.mapId, mapId))
        .orderBy(asc(tiles.id)),

    coolingTiles: async (mapId, at) => {
      const rows = await db
        .selectDistinct({ tileId: tileAttacks.tileId })
        .from(tileAttacks)
        .where(and(eq(tileAttacks.mapId, mapId), gt(tileAttacks.cooldownUntil, at)));
      return new Set(rows.map((r) => r.tileId));
    },

    fencesOn: async (tileIds) => {
      if (tileIds.length === 0) return new Map();
      const rows = await db
        .select({ tileId: fenceSegments.tileId, n: count() })
        .from(fenceSegments)
        .where(inArray(fenceSegments.tileId, [...tileIds]))
        .groupBy(fenceSegments.tileId);
      return new Map(rows.map((r) => [r.tileId, r.n]));
    },

    strengthPercent: async (mapId) => {
      const [row] = await db
        .select({ percent: maps.hollowStrengthPercent })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row?.percent ?? 100;
    },

    activeMembers: (mapId) =>
      db
        .select({ userId: mapMembers.userId, joinedAt: mapMembers.joinedAt })
        .from(mapMembers)
        .where(activeMember(mapId))
        .orderBy(asc(mapMembers.userId)),

    homeTiles: async (mapId) => {
      const rows = await db
        .select({ ownerUserId: tiles.ownerUserId, q: tiles.q, r: tiles.r })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), isNotNull(tiles.homeSlot), isNotNull(tiles.ownerUserId)))
        .orderBy(asc(tiles.q), asc(tiles.r));
      return rows.flatMap((r) => (r.ownerUserId ? [{ ...r, ownerUserId: r.ownerUserId }] : []));
    },

    lockPostTiles: async (mapId) => {
      await db
        .select({ id: tiles.id })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            inArray(
              tiles.id,
              db
                .select({ tileId: tileDefenders.tileId })
                .from(tileDefenders)
                .where(eq(tileDefenders.mapId, mapId)),
            ),
          ),
        )
        // Id order (tech spec §7 "Lock order"), like jobs' `lockTiles`.
        .orderBy(asc(tiles.id))
        .for('no key update');
    },

    nightSquishies: async (mapId, { lock = true } = {}) => {
      const habitatTile = alias(tiles, 'habitat_tile');
      const postTile = alias(tiles, 'post_tile');
      const workTile = alias(tiles, 'night_work_tile');
      const query = db
        .select({
          id: squishies.id,
          ownerUserId: squishies.ownerUserId,
          state: squishies.state,
          habitatQ: habitatTile.q,
          habitatR: habitatTile.r,
          posted: tileDefenders.squishyId,
          postOwnerUserId: postTile.ownerUserId,
          postQ: postTile.q,
          postR: postTile.r,
          // A gatherer still at work (jobs' `squishyAtWork`) sleeps on its tile.
          atWork: squishyAtWork(),
          workQ: workTile.q,
          workR: workTile.r,
        })
        .from(squishies)
        .innerJoin(mapMembers, activeMember(squishies.mapId, squishies.ownerUserId))
        .leftJoin(buildings, eq(buildings.id, squishies.habitatBuildingId))
        .leftJoin(habitatTile, eq(habitatTile.id, buildings.tileId))
        // The post and who holds its tile, not territory's `squishyOnWatch`:
        // shared `shelterOf` decides from them (shared `isOnWatch`, the same
        // rule plus `state`), so nightfall stays a pure step over plain rows.
        .leftJoin(tileDefenders, eq(tileDefenders.squishyId, squishies.id))
        .leftJoin(postTile, eq(postTile.id, tileDefenders.tileId))
        .leftJoin(workTile, eq(workTile.id, squishies.workTileId))
        .where(eq(squishies.mapId, mapId))
        .orderBy(asc(squishies.id))
        // Locked until commit, so a squishy can't be moved into or out of a
        // habitat (#18 locks it) between this read and being taken (lock order:
        // the night's row, then squishies). Posting a guard (#15) locks the
        // squishy too, but the joined `tile_defenders` row isn't read again
        // after a lock wait, so a post at the very stroke of nightfall can race.
        .$dynamic();
      const rows = await (lock ? query.for('update', { of: squishies }) : query);
      return rows.map((r) => ({
        id: r.id,
        ownerUserId: r.ownerUserId,
        state: r.state,
        habitat:
          r.habitatQ !== null && r.habitatR !== null ? { q: r.habitatQ, r: r.habitatR } : null,
        postOwnerUserId: r.posted === null ? undefined : r.postOwnerUserId,
        post: r.postQ !== null && r.postR !== null ? { q: r.postQ, r: r.postR } : null,
        work: r.atWork && r.workQ !== null && r.workR !== null ? { q: r.workQ, r: r.workR } : null,
      }));
    },

    leavePosts: async (squishyIds) => {
      if (squishyIds.length === 0) return;
      await db.delete(tileDefenders).where(inArray(tileDefenders.squishyId, [...squishyIds]));
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
