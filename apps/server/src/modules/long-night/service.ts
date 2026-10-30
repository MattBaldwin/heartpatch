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
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { instantOfLocalDate, onGameClock, type Clock } from '../../lib/time.js';
import type { BuildingRow } from '../buildings/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
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
  if (!PATCHES.includes(map.kind) || !(await longNightOnMap(db, longNight, map.id))) return null;
  const repo = createLongNightRepo(db);
  const [weekday, latest] = await Promise.all([repo.weekday(map.id), repo.latest(map.id)]);
  if (weekday === undefined || !isLongNight(weekday, night, latest?.night ?? null)) return null;
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
  },
): Promise<HollowStatus['longNight']> {
  const { map, user, local, at, showNight, fallen } = args;
  if (!PATCHES.includes(map.kind) || !(await longNightOnMap(db, longNight, map.id))) {
    return undefined;
  }
  const repo = createLongNightRepo(db);
  const [stored, latest] = await Promise.all([repo.weekday(map.id), repo.latest(map.id)]);
  const weekday: LongNightWeekday | null = stored ?? null;
  const latestNight = latest?.night ?? null;
  const window = latest ? windowOf(latest) : null;
  const mine = latest?.outcomes.find((o) => o.userId === user.id);
  const nextAt = nextLongNightAt(local, weekday, latestNight, HOME_BASE_RULES, (l) =>
    instantOfLocalDate(l, map.timeZone),
  );
  return {
    weekday,
    // A night that has fallen was one if it left a row; a coming one if it will be.
    tonight: latestNight === showNight || (!fallen && isLongNight(weekday, showNight, latestNight)),
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
  };
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
}

export interface LongNightService {
  /** The patch owner picks the Long Night's weekday, or Off (null). */
  setWeekday: (
    user: PublicUser,
    mapId: string,
    weekday: LongNightWeekday | null,
  ) => Promise<LongNightWeekday | null>;
}

export function createLongNightService(options: LongNightServiceOptions): LongNightService {
  const { db } = options;
  const longNight = options.longNight ?? LONG_NIGHT_OFF;
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
  };
}
