import { addDays, daysBetween, localDateToDays } from '../home/local-date.js';
import { tonightOf, type MapLocalTime } from '../home/hearthfire.js';
import type { HollowRules } from '../schemas/data/hollow.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';
import type { LongNightRules, LongNightWeekday } from '../schemas/data/long-night.js';
import type { LocalDate } from '../schemas/time.js';

// The Long Night (#727, plan on the issue, owner answers 2026-10-30). Pure:
// the server reads the patch's weekday, its latest `long_nights` row, the
// fires and the clock, and passes them in. A night is named by the map-local
// date its nightfall falls on, as everywhere in the Hollow.

type NightfallRules = Pick<HomeBaseRules, 'nightfallMinute'>;

/** Days between two Long Nights on a patch, at least: a week. */
const WEEK = 7;

/**
 * The weekday of a map-local date: 0 is Sunday, 6 is Saturday. It's the
 * date's own weekday in map time, worked out from the calendar date alone,
 * so it never depends on UTC (1970-01-01 was a Thursday).
 */
export function weekdayOf(date: LocalDate): LongNightWeekday {
  return (((localDateToDays(date) + 4) % WEEK) + WEEK) % WEEK;
}

/**
 * Is `night` a Long Night on a patch (#727)? It must fall on the patch's
 * weekday (null: Off), and the patch mustn't have had one in the 6 nights
 * before it (`latest` is the patch's newest `long_nights.night`), so an
 * owner who moves the day mid-week can't bring two in one week. `latest`
 * equal to `night` is the same Night resolved again, so it still counts.
 * Whether the Long Night is switched on at all (`HP_LONG_NIGHT`) is the
 * server's to check.
 */
export function isLongNight(
  weekday: LongNightWeekday | null,
  night: LocalDate,
  latest: LocalDate | null,
): boolean {
  if (weekday === null || weekdayOf(night) !== weekday) return false;
  if (latest === null) return true;
  const since = daysBetween(latest, night);
  // A `latest` after `night` (a later Night already ran) never makes this one.
  return since === 0 || since >= WEEK;
}

/**
 * The next Long Night's nightfall, map-local, from `now`: the coming (or
 * current) night if it's one, else the first after it. Null while it's Off.
 * The server turns it into an instant in the map's zone (`instantOfLocal`,
 * as nightfall does), which is where daylight saving falls out. Nothing is
 * stored (CLAUDE.md rule 4).
 */
export function nextLongNight(
  now: MapLocalTime,
  weekday: LongNightWeekday | null,
  latest: LocalDate | null,
  rules: NightfallRules,
): MapLocalTime | null {
  if (weekday === null) return null;
  const tonight = tonightOf(now, rules);
  // Within two weeks: the weekday comes round once a week, and the 6-night
  // guard only ever skips one of them.
  for (let d = 0; d < 2 * WEEK; d++) {
    const night = addDays(tonight, d);
    if (isLongNight(weekday, night, latest)) return { date: night, minute: rules.nightfallMinute };
  }
  return null;
}

/**
 * `nextLongNight` as an instant, through the caller's map-local → instant
 * conversion (the server's `instantOfLocal` in the map's zone; shared code
 * doesn't use `Intl`).
 */
export function nextLongNightAt(
  now: MapLocalTime,
  weekday: LongNightWeekday | null,
  latest: LocalDate | null,
  rules: NightfallRules,
  instantOf: (local: MapLocalTime) => Date,
): Date | null {
  const next = nextLongNight(now, weekday, latest, rules);
  return next === null ? null : instantOf(next);
}

/**
 * The Hollow Man's strength percent on a Long Night: the patch's own
 * (`maps.hollow_strength_percent`, admin 0–300) times the secret
 * multiplier, passed to `rollStrikes` as its `percent`. 0 stays 0: a patch
 * an admin switched off stays off. Each chance still clamps at 100 and the
 * strike cap (gentle: 1) still holds, inside `rollStrikes`.
 */
export function longNightPercent(percent: number, strengthMultiplier: number): number {
  return percent * strengthMultiplier;
}

/**
 * Is a Keeper counted for the patch's hold? Not while graced (their first
 * nights on the patch), nor once they've been away
 * `LONG_NIGHT_RULES.awayAfterDays` (`daysAway`: whole days since their
 * last `game_events` row; null: none). An uncounted Keeper can still help
 * the patch hold, but never breaks it.
 */
export function isKeeperCounted(
  grace: boolean,
  daysAway: number | null,
  rules: Pick<LongNightRules, 'awayAfterDays'>,
): boolean {
  return !grace && daysAway !== null && daysAway < rules.awayAfterDays;
}

/** One Keeper's night, as the hold reads it. */
export interface KeeperHold {
  readonly counted: boolean;
  /** He took nothing of theirs tonight: no squishy and no tile. */
  readonly held: boolean;
}

/**
 * Did the patch hold the Long Night? Every counted Keeper held, and at
 * least one Keeper did. An uncounted Keeper (graced, or away) can't break
 * it, and can hold it through preparation (stocked fuel, lit fires, guards
 * on their posts; owner answer Q2), so a one-member patch holds whenever
 * its Keeper does, even while they're away. No Keepers: no hold.
 */
export function patchHeld(keepers: readonly KeeperHold[]): boolean {
  return keepers.some((k) => k.held) && keepers.every((k) => !k.counted || k.held);
}

/** One Keeper's fires, for the night crown. */
export interface KeeperFires {
  readonly userId: string;
  /** Hearthfires of theirs lit at nightfall. */
  readonly firesLit: number;
  /** Nights of fuel they had stocked across those fires. */
  readonly fuelNights: number;
}

/**
 * Keeper of the Night (#727): most fires lit at nightfall, then most fuel
 * nights stocked, then the lower user id, so it's always one Keeper. Null
 * when nobody lit a fire (there's nothing to crown).
 */
export function keeperOfTheNight(keepers: readonly KeeperFires[]): string | null {
  let best: KeeperFires | null = null;
  for (const k of keepers) {
    if (k.firesLit <= 0) continue;
    if (
      best === null ||
      k.firesLit > best.firesLit ||
      (k.firesLit === best.firesLit &&
        (k.fuelNights > best.fuelNights ||
          (k.fuelNights === best.fuelNights && k.userId < best.userId)))
    ) {
      best = k;
    }
  }
  return best?.userId ?? null;
}

/** Juniper's Gap's window after a Long Night. */
export interface GapWindow {
  readonly opensAt: Date;
  readonly closesAt: Date;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Juniper's Gap after a Long Night (#727): it opens at the strike (nightfall
 * plus `prowlMinutes`) and stays open `gapOpenHours`. Null when the patch
 * didn't hold (`long_nights.gap_opens_at` and `gap_closes_at` stay null).
 */
export function gapWindow(
  nightfallAt: Date,
  held: boolean,
  rules: Pick<LongNightRules, 'gapOpenHours'> & Pick<HollowRules, 'show'>,
): GapWindow | null {
  if (!held) return null;
  const opensAt = new Date(nightfallAt.getTime() + rules.show.prowlMinutes * MINUTE_MS);
  return { opensAt, closesAt: new Date(opensAt.getTime() + rules.gapOpenHours * HOUR_MS) };
}

/** Is the Gap open at `now`? `opensAt <= now < closesAt`; never for a patch that didn't hold. */
export function isGapOpen(window: GapWindow | null, now: Date): boolean {
  return (
    window !== null &&
    window.opensAt.getTime() <= now.getTime() &&
    now.getTime() < window.closesAt.getTime()
  );
}
