import {
  canonicalJson,
  gapWindow,
  hashString,
  HOME_BASE_RULES,
  isGapOpen,
  isKeeperCounted,
  isLongNight,
  keeperOfTheNight,
  LONG_NIGHT_RULES,
  longNightPercent,
  nextLongNightAt,
  patchHeld,
  protectsNight,
  daysBetween,
  GROWTH_RULES,
  type GameEventPayload,
  type HollowRules,
  type HollowStatus,
  type LocalDate,
  type LongNightOutcome,
  type LongNightOutcomeRow,
  type LongNightWeekday,
  type MapLocalTime,
  type PatchStats,
  type PublicUser,
} from '@heartpatch/shared';
import {
  LONG_NIGHT_GAP_TABLE,
  LONG_NIGHT_SECRETS,
  longNightContentHash,
  rollGapEncounter,
  SPAWN_RULES,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { instantOfLocalDate, onGameClock, type Clock } from '../../lib/time.js';
import type { BattlesService, StartResult } from '../battles/service.js';
import type { BuildingRow } from '../buildings/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { createLongNightRepo, type LongNightRow } from './repo.js';
import { LONG_NIGHT_OFF, longNightOnFor, type LongNightSwitch } from './switch.js';

/*
 * The Long Night (#727, plan and owner answers on the issue). Once a week, on
 * the patch's weekday, the ordinary nightfall (`hollow/service.ts` `fall`)
 * runs with the Hollow Man stronger by a secret multiplier, and records who
 * held, whether the patch held, Keeper of the Night and Juniper's Gap's
 * window in a `long_nights` row, in nightfall's own transaction. Nothing
 * ticks (rule 4): the schedule is a weekday on `maps`, the Gap two
 * timestamps, the countdown worked out on read. The strength and each
 * Keeper's `outcomes` never leave the server (rule 6).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const MESSAGES = {
  notOwner: 'Only the patch owner can change that.',
  noMap: "We couldn't find that patch.",
  gapClosed: "Juniper's Gap is closed. Hold a Long Night together to open it!",
  gapClaimed: "You already went through Juniper's Gap this week. See you next Long Night!",
  notAKeeper: "Juniper's Gap is for Keepers who stood through the Long Night. Next time!",
  noHeldNight: 'No held Long Night to open the Gap for. Make night fall on one first.',
} as const;

/** Only multiplayer patches have Long Nights: the Glade's night is scripted. */
const PATCHES: readonly MapRow['kind'][] = ['multiplayer'];

/** Is the Long Night switched on for this patch (`HP_LONG_NIGHT`)? */
export async function longNightOnMap(
  db: Executor,
  longNight: LongNightSwitch,
  mapId: string,
): Promise<boolean> {
  if (longNight.mode !== 'testers') return longNight.mode === 'on';
  return longNightOnFor(longNight, await createLongNightRepo(db).usernames(mapId));
}

/**
 * The content a Night ran under, for `long_nights.content_hash`: the Long
 * Night's rules, secrets and Gap table, and the Hollow's own rules (stage
 * chances, caps, `prowlMinutes`), so a stored Night can be replayed.
 */
export function longNightNightHash(hollowRules: HollowRules): string {
  return hashString(
    canonicalJson({
      longNight: longNightContentHash(LONG_NIGHT_RULES, LONG_NIGHT_SECRETS, LONG_NIGHT_GAP_TABLE),
      hollow: hollowRules,
    }),
  );
}

/**
 * Is `night` a Long Night on this map: a multiplayer patch, switched on
 * there (`HP_LONG_NIGHT`), on its weekday and not one in the 6 nights
 * before? Only a yes or no, so it's safe for callers that must never see
 * the Night's secrets (the push sweep, #726f; CLAUDE.md rule 6). Still yes
 * once nightfall has recorded that Night (`isLongNight` counts it).
 */
export async function isLongNightOn(
  db: Executor,
  longNight: LongNightSwitch,
  map: Pick<MapRow, 'id' | 'kind'>,
  night: LocalDate,
): Promise<boolean> {
  if (!PATCHES.includes(map.kind) || !(await longNightOnMap(db, longNight, map.id))) return false;
  const repo = createLongNightRepo(db);
  const [weekday, latest] = await Promise.all([repo.weekday(map.id), repo.latest(map.id)]);
  return weekday !== undefined && isLongNight(weekday, night, latest?.night ?? null);
}

/**
 * Tonight on a map is a Long Night: what nightfall needs to run it. Null on
 * any other night (switched off, Off on the patch, not its weekday, one in
 * the last 6 nights, or the Glade).
 */
export async function longNightTonight(
  db: Executor,
  longNight: LongNightSwitch,
  map: Pick<MapRow, 'id' | 'kind'>,
  night: LocalDate,
): Promise<{ percentOf: (percent: number) => number } | null> {
  if (!(await isLongNightOn(db, longNight, map, night))) return null;
  return {
    // Secret (rule 6): only `rollStrikes` and the server-only row see it.
    percentOf: (percent) => longNightPercent(percent, LONG_NIGHT_SECRETS.strengthMultiplier),
  };
}

/** One Keeper's night as the Long Night reads it, from `fall`. */
export interface LongNightKeeper {
  readonly userId: string;
  /** First-night grace: they can't break the hold. */
  readonly grace: boolean;
  /** When they joined the patch (game clock): activity, if they've done nothing since. */
  readonly joinedAt: Date;
  /** He took nothing of theirs and won back none of their land. */
  readonly held: boolean;
}

export interface ResolveLongNight {
  readonly map: Pick<MapRow, 'id' | 'timeZone'>;
  readonly night: LocalDate;
  /** When nightfall ran (game clock). */
  readonly at: Date;
  /** The map's seed: every seed of the night derives from it. */
  readonly seed: string;
  /** The scaled strength every strike rolled with. */
  readonly percent: number;
  /** Every Keeper in the night's outcomes, in member order. */
  readonly keepers: readonly LongNightKeeper[];
  /** The map's Hearthfires, as nightfall read them. */
  readonly fires: readonly Pick<BuildingRow, 'ownerUserId' | 'fuelledThrough'>[];
  readonly hollowRules: HollowRules;
}

/** What `fall` appends: the `hollow.nightfall` field, then the events after it. */
export interface LongNightResolved {
  readonly result: NonNullable<GameEventPayload<'hollow.nightfall'>['longNight']>;
  readonly events: readonly NewGameEvent[];
}

/**
 * Resolves a Long Night inside nightfall's transaction: who held and who is
 * counted, the patch's hold, Keeper of the Night, Juniper's Gap and each
 * Keeper's Gap encounter (rolled now, server-only, owner answer Q4: every
 * Keeper in the outcomes, graced ones too). Writes the `long_nights` row
 * (a row this transaction inserts: no lock, tech spec §7) and returns the
 * events for the caller to append after `hollow.nightfall`, `maps` last.
 */
export async function resolveLongNight(
  tx: Executor,
  night: ResolveLongNight,
): Promise<LongNightResolved> {
  const { map, at, keepers, hollowRules } = night;
  const repo = createLongNightRepo(tx);
  const seen = await repo.lastActive(
    map.id,
    keepers.map((k) => k.userId),
  );
  const fires = (userId: string) => {
    const lit = night.fires.filter(
      (f) => f.ownerUserId === userId && protectsNight(f.fuelledThrough, night.night),
    );
    return {
      firesLit: lit.length,
      // Nights of fuel stocked across them, tonight's included.
      fuelNights: lit.reduce(
        (sum, f) => sum + (f.fuelledThrough ? daysBetween(night.night, f.fuelledThrough) + 1 : 0),
        0,
      ),
    };
  };
  const counted = keepers.map((k) => {
    // Their newest event on the patch (`created_at` is the real clock;
    // nightfall's `at` the game clock), or joining it if that's later: a
    // Keeper who joined and has only watched since isn't away.
    const event = seen.get(k.userId);
    const last = Math.max(k.joinedAt.getTime(), event ? onGameClock(event, at).getTime() : 0);
    const daysAway = Math.max(0, Math.floor((at.getTime() - last) / DAY_MS));
    return {
      ...k,
      ...fires(k.userId),
      counted: isKeeperCounted(k.grace, daysAway, LONG_NIGHT_RULES),
    };
  });
  const held = patchHeld(counted);
  const heldBy = counted.filter((k) => k.held).map((k) => k.userId);
  const keeperOfNight = keeperOfTheNight(counted);
  const nightfallAt = instantOfLocalDate(
    { date: night.night, minute: HOME_BASE_RULES.nightfallMinute },
    map.timeZone,
  );
  const strikeAt = new Date(nightfallAt.getTime() + hollowRules.show.prowlMinutes * 60_000);
  const gap = gapWindow(nightfallAt, held, { ...LONG_NIGHT_RULES, show: hollowRules.show });
  const results: LongNightOutcome[] = counted.map((k) => ({
    userId: k.userId,
    counted: k.counted,
    held: k.held,
    firesLit: k.firesLit,
    fuelNights: k.fuelNights,
    percent: night.percent,
    gapSpeciesId: held
      ? rollGapEncounter(night.seed, night.night, k.userId, LONG_NIGHT_GAP_TABLE)
      : null,
  }));
  // Nobody has claimed their Gap encounter yet (#727d claims it).
  const outcomes: LongNightOutcomeRow[] = results.map((o) => ({
    ...o,
    gapClaimedAt: null,
    gapBattleId: null,
  }));
  await repo.insert({
    mapId: map.id,
    night: night.night,
    ranAt: at,
    strikeAt,
    held,
    outcomes,
    keeperOfNightUserId: keeperOfNight,
    gapOpensAt: gap?.opensAt ?? null,
    gapClosesAt: gap?.closesAt ?? null,
    seed: night.seed,
    contentHash: longNightNightHash(hollowRules),
  });
  const events: NewGameEvent[] = [
    {
      mapId: map.id,
      type: 'longnight.resolved',
      actorUserId: null,
      payload: {
        night: night.night,
        held,
        heldBy,
        keeperOfNight,
        // Internal only: the public view strips it (rule 6).
        outcomes: results,
      },
    } satisfies NewGameEvent<'longnight.resolved'>,
  ];
  if (gap) {
    events.push({
      mapId: map.id,
      type: 'gap.opened',
      actorUserId: null,
      payload: { night: night.night, closesAt: gap.closesAt.toISOString() },
    } satisfies NewGameEvent<'gap.opened'>);
  }
  return {
    result: { held, heldBy, keeperOfNight, gapClosesAt: gap?.closesAt.toISOString() ?? null },
    events,
  };
}

/** The Gap window a stored Night opened, or null on a miss. */
const windowOf = (row: LongNightRow) =>
  row.gapOpensAt && row.gapClosesAt ? { opensAt: row.gapOpensAt, closesAt: row.gapClosesAt } : null;

/**
 * The Hollow status's `longNight` block for me (#727): the weekday, whether
 * the night the show is about is a Long Night, the next one's nightfall and
 * an open Gap. Undefined while it's switched off for the patch (left out of
 * the reply). Never the strength or the Gap species (rule 6).
 */
export async function longNightStatus(
  db: Executor,
  longNight: LongNightSwitch,
  args: {
    map: Pick<MapRow, 'id' | 'kind' | 'timeZone'>;
    user: Pick<PublicUser, 'id'>;
    /** Now, map-local, and as an instant. */
    local: MapLocalTime;
    at: Date;
    /** The night the show is about (`tonight.night`), and whether it has fallen. */
    showNight: LocalDate;
    fallen: boolean;
    /** He can strike here (not 0 %): where he only watches, no Night comes. */
    strikes: boolean;
  },
): Promise<HollowStatus['longNight']> {
  const { map, user, local, at, showNight, fallen, strikes } = args;
  if (!PATCHES.includes(map.kind) || !(await longNightOnMap(db, longNight, map.id))) {
    return undefined;
  }
  const repo = createLongNightRepo(db);
  const [stored, latest] = await Promise.all([repo.weekday(map.id), repo.latest(map.id)]);
  const weekday: LongNightWeekday | null = stored ?? null;
  const latestNight = latest?.night ?? null;
  const window = latest ? windowOf(latest) : null;
  const mine = latest?.outcomes.find((o) => o.userId === user.id);
  // At 0 % no Night runs (`fall`), so there's nothing to count down to.
  const nextAt = strikes
    ? nextLongNightAt(local, weekday, latestNight, HOME_BASE_RULES, (l) =>
        instantOfLocalDate(l, map.timeZone),
      )
    : null;
  return {
    weekday,
    // A night that has fallen was one if it left a row; a coming one if it will be.
    tonight:
      latestNight === showNight ||
      (!fallen && strikes && isLongNight(weekday, showNight, latestNight)),
    nextAt: nextAt?.toISOString() ?? null,
    gap:
      latest && window && isGapOpen(window, at)
        ? {
            night: latest.night,
            opensAt: window.opensAt.toISOString(),
            closesAt: window.closesAt.toISOString(),
            available:
              mine !== undefined && mine.gapSpeciesId !== null && mine.gapClaimedAt === null,
          }
        : null,
    // The Night's result for a Keeper who missed it live (727e2). The
    // row's outcomes are in member order, as the event's `heldBy`.
    ...(latest && {
      last: {
        night: latest.night,
        held: latest.held,
        heldBy: latest.outcomes.filter((o) => o.held).map((o) => o.userId),
        keeperOfNight: latest.keeperOfNightUserId,
      },
    }),
  };
}

/**
 * How many times the day's rewarded rescues a Keeper gets (#727d): the
 * Long Night's `rescueRewardsMultiplier` while the patch's Juniper's Gap is
 * open at `at` (game clock), else 1. A plain read: a Night's window never
 * changes once written. Server-only (rule 6).
 */
export async function rescueRewardsMultiplierOn(
  db: Executor,
  longNight: LongNightSwitch,
  mapId: string,
  at: Date,
): Promise<number> {
  if (!(await longNightOnMap(db, longNight, mapId))) return 1;
  const latest = await createLongNightRepo(db).latest(mapId);
  const window = latest ? windowOf(latest) : null;
  return window && isGapOpen(window, at) ? LONG_NIGHT_RULES.rescueRewardsMultiplier : 1;
}

/**
 * A Gap squishy's level: the Keeper's Partner's, as the top of a wild
 * spawn's `partnerOffset` (a rare one is a step harder, owner decision
 * 2026-10-07), else the top of the plain range. No roll: the species was
 * the roll.
 */
// TUNE: the top of the wild range; data-driven through `SPAWN_RULES`.
const gapLevel = (partnerLevel: number | null) =>
  partnerLevel === null
    ? SPAWN_RULES.levels.max
    : Math.max(
        SPAWN_RULES.levels.min,
        Math.min(GROWTH_RULES.maxLevel, partnerLevel + (SPAWN_RULES.partnerOffset?.max ?? 0)),
      );

/** Map details' `longNightWeekday` (#727): undefined while switched off for the patch. */
export async function longNightWeekdayOn(
  db: Executor,
  longNight: LongNightSwitch,
  mapId: string,
): Promise<LongNightWeekday | null | undefined> {
  if (!(await longNightOnMap(db, longNight, mapId))) return undefined;
  return (await createLongNightRepo(db).weekday(mapId)) ?? null;
}

/**
 * Patch stats' `night` crown (#727): Keeper of the Night from the patch's
 * latest Long Night (null when it crowned nobody, or before the first).
 * Undefined while switched off for the patch (left out of the reply).
 */
export async function keeperOfTheNightOn(
  db: Executor,
  longNight: LongNightSwitch,
  mapId: string,
): Promise<PatchStats['keeperOfTheNight']> {
  if (!(await longNightOnMap(db, longNight, mapId))) return undefined;
  const latest = await createLongNightRepo(db).latest(mapId);
  return latest?.keeperOfNightUserId
    ? { userId: latest.keeperOfNightUserId, night: latest.night }
    : null;
}

export interface LongNightServiceOptions {
  db: Executor;
  /** `HP_LONG_NIGHT`; off when left out. */
  longNight?: LongNightSwitch;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Juniper's Gap encounters are wild battles (#727d). */
  battles: Pick<BattlesService, 'startEncounter'>;
}

export interface LongNightService {
  /** The patch owner picks the Long Night's weekday, or Off (null). */
  setWeekday: (
    user: PublicUser,
    mapId: string,
    weekday: LongNightWeekday | null,
  ) => Promise<LongNightWeekday | null>;
  /**
   * Claims my Juniper's Gap encounter (#727d): a wild battle against the
   * species rolled for me at resolve, once per Long Night while the Gap is
   * open; or resumes the battle going. The species is never sent before.
   */
  claimGap: (user: PublicUser, mapId: string) => Promise<StartResult>;
  /**
   * Dev/test only (727e2, `POST /maps/:id/dev/gap-now`): the patch's latest
   * Long Night, if it held, opens its Gap from now for a Gap's usual
   * length, so an e2e can go look by day. Nothing else of the Night moves.
   */
  devGapNow: (
    user: PublicUser,
    mapId: string,
  ) => Promise<{ night: LocalDate; opensAt: string; closesAt: string }>;
}

export function createLongNightService(options: LongNightServiceOptions): LongNightService {
  const { db } = options;
  const longNight = options.longNight ?? LONG_NIGHT_OFF;
  const now = options.clock ?? (() => new Date());
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };
  return {
    setWeekday: async (user, mapId, weekday) => {
      const { role } = await requireMember(db, user, mapId, PATCHES);
      // Switched off, it isn't there at all (like the Keeper's house).
      if (!(await longNightOnMap(db, longNight, mapId))) {
        throw new AppError('NOT_FOUND', MESSAGES.noMap);
      }
      if (role !== 'owner') throw new AppError('FORBIDDEN', MESSAGES.notOwner);
      const changed = await createLongNightRepo(db).transaction(async (repo, tx) => {
        if (!(await repo.setWeekday(mapId, weekday))) return false;
        // The patch's other settings as this transaction reads them.
        const map = await createMapsRepo(tx).findMap(mapId);
        await repo.appendEvent({
          mapId,
          type: 'map.updated',
          actorUserId: user.id,
          payload: {
            pvpMode: map?.pvpMode ?? 'gentle',
            ...(map && {
              tradingEnabled: map.tradingEnabled,
              friendlyChallenges: map.friendlyChallenges,
            }),
            longNightWeekday: weekday,
          },
        });
        return true;
      });
      if (changed) published(mapId);
      return weekday;
    },

    claimGap: async (user, mapId) => {
      await requireMember(db, user, mapId, PATCHES);
      if (!(await longNightOnMap(db, longNight, mapId))) {
        throw new AppError('NOT_FOUND', MESSAGES.noMap);
      }
      // One transaction (rule 7): the battle starts and the claim is written
      // under the Night's row lock (step 9), so two taps start one battle.
      // The battle's own coins and finds come from its finish, as any wild
      // battle's; nothing is credited here.
      return options.battles.startEncounter(user, mapId, async (tx, { at }) => {
        const repo = createLongNightRepo(tx);
        const night = await repo.lockLatest(mapId);
        const window = night ? windowOf(night) : null;
        if (!night || !window || !isGapOpen(window, at)) {
          throw new AppError('CONFLICT', MESSAGES.gapClosed);
        }
        const mine = night.outcomes.find((o) => o.userId === user.id);
        if (!mine?.gapSpeciesId) throw new AppError('FORBIDDEN', MESSAGES.notAKeeper);
        if (mine.gapClaimedAt !== null) throw new AppError('CONFLICT', MESSAGES.gapClaimed);
        const level = gapLevel(await createSpawnsRepo(tx).partnerLevel(mapId, user.id));
        return {
          squishies: [{ id: 'wild-1', speciesId: mine.gapSpeciesId, level }],
          started: async (startTx, battle) => {
            await createLongNightRepo(startTx).setOutcomes(
              night.id,
              night.outcomes.map((o) =>
                o.userId === user.id
                  ? { ...o, gapClaimedAt: at.toISOString(), gapBattleId: battle.id }
                  : o,
              ),
            );
            // `battle.started` says it all; the claim itself stays server-side.
            return [];
          },
        };
      });
    },

    devGapNow: async (user, mapId) => {
      await requireMember(db, user, mapId, PATCHES);
      if (!(await longNightOnMap(db, longNight, mapId))) {
        throw new AppError('NOT_FOUND', MESSAGES.noMap);
      }
      const opened = await createLongNightRepo(db).transaction(async (repo) => {
        const night = await repo.lockLatest(mapId);
        const window = night ? windowOf(night) : null;
        // Only a Night that held has a Gap: never one for a Night he broke.
        if (!night?.held || !window) throw new AppError('CONFLICT', MESSAGES.noHeldNight);
        const opensAt = now();
        const closesAt = new Date(
          opensAt.getTime() + window.closesAt.getTime() - window.opensAt.getTime(),
        );
        await repo.setGapWindow(night.id, opensAt, closesAt);
        // Live clients ask for the status again, as at the real strike.
        await repo.appendEvent({
          mapId,
          type: 'gap.opened',
          actorUserId: null,
          payload: { night: night.night, closesAt: closesAt.toISOString() },
        });
        return {
          night: night.night,
          opensAt: opensAt.toISOString(),
          closesAt: closesAt.toISOString(),
        };
      });
      published(mapId);
      return opened;
    },
  };
}
