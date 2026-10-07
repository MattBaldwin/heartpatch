import { hexKey, type Hex, type HexKey } from '../hex/index.js';
import { addDays } from '../home/local-date.js';
import { tonightOf, type MapLocalTime } from '../home/hearthfire.js';
import { Rng, type Seed } from '../rng/index.js';
import type { HollowRules } from '../schemas/data/hollow.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';
import type { SquishyState } from '../schemas/squishies.js';
import type { LocalDate } from '../schemas/time.js';
import { isOnWatch, type WatchPost } from '../territory/index.js';

// The Hollow Man (design doc §14, decision C). Pure: the server turns the
// clock into map-local time, reads the fires, posts and squishies, and passes
// them in. A night is named by the map-local date its nightfall falls on.

type NightfallRules = Pick<HomeBaseRules, 'nightfallMinute'>;
type MorningRules = Pick<HollowRules, 'morningMinute'>;
type GraceRules = NightfallRules & Pick<HollowRules, 'graceNights'>;

/** The night of the latest nightfall at or before `local` (yesterday's before 9 PM). */
export function lastNightOf(local: MapLocalTime, rules: NightfallRules): LocalDate {
  return local.minute >= rules.nightfallMinute ? local.date : addDays(local.date, -1);
}

/** Is `a` earlier than `b`? Map-local wall-clock times on the same map. */
export function isLocalBefore(a: MapLocalTime, b: MapLocalTime): boolean {
  return a.date < b.date || (a.date === b.date && a.minute < b.minute);
}

/**
 * The first night the Hollow Man can visit a player who joined the patch at
 * `joined` (map-local, game clock): their first `graceNights` nightfalls
 * after joining are skipped (owner decision 2026-10-03). Joining at 8:55 PM
 * makes that evening's nightfall the first of them; joining at 9:00 PM or
 * later, the next day's.
 */
export function firstHollowNight(joined: MapLocalTime, rules: GraceRules): LocalDate {
  return addDays(tonightOf(joined, rules), rules.graceNights);
}

/** Is it night on the map (between nightfall and morning)? Only for how the map looks. */
export function isNightAt(local: MapLocalTime, rules: NightfallRules & MorningRules): boolean {
  return local.minute >= rules.nightfallMinute || local.minute < rules.morningMinute;
}

/**
 * Wall-clock minutes until night falls or morning comes, whichever is next
 * (at least 1). On a daylight-saving day it can be an hour out; the client
 * just asks again then.
 */
export function minutesUntilNightChange(
  local: MapLocalTime,
  rules: NightfallRules & MorningRules,
): number {
  const next = [rules.morningMinute, rules.nightfallMinute, rules.morningMinute + 1440].find(
    (minute) => minute > local.minute,
  );
  return Math.max(1, (next ?? local.minute + 1) - local.minute);
}

/** The Heart Seed: the middle of a home base (the mean of its seven tiles), or null. */
export function heartSeedOf(homeTiles: readonly Hex[]): Hex | null {
  if (homeTiles.length === 0) return null;
  const q = homeTiles.reduce((sum, t) => sum + t.q, 0) / homeTiles.length;
  const r = homeTiles.reduce((sum, t) => sum + t.r, 0) / homeTiles.length;
  return Number.isInteger(q) && Number.isInteger(r) ? { q, r } : null;
}

/** A squishy as nightfall sees it. */
export interface NightSquishy {
  readonly id: string;
  readonly ownerUserId: string;
  readonly state: SquishyState;
  /**
   * The tile it sleeps on: its habitat's, or else its owner's Heart Seed
   * (design doc §13, squishies without a habitat wait by the Heart Seed).
   * Null if it has neither: nothing shelters it.
   */
  readonly sleepsAt: Hex | null;
  /**
   * The tile it stands watch on, if it's posted (decision C), and where that
   * tile is: a guard spends the night there.
   */
  readonly post: (WatchPost & { readonly at: Hex }) | null;
}

/**
 * Where a squishy stands at nightfall:
 * - `hollowed`: already in the Hollow;
 * - `on-watch`: guarding its owner's land inside a lit Hearthfire's light (or
 *   on a home tile). A guard out in the dark is `exposed`, like a gatherer
 *   sleeping there (owner decision 2026-10-07, superseding decision C's
 *   "guards are safe on watch");
 * - `safe`: it sleeps inside the safe tiles (home, or a lit fire's reach);
 * - `exposed`: the Hollow Man may take it.
 */
export type Shelter = 'hollowed' | 'on-watch' | 'safe' | 'exposed';

/** `safe`: every home tile and the tiles lit fires protect tonight (`safeTiles` / `litSafeTiles`). */
export function shelterOf(squishy: NightSquishy, safe: ReadonlySet<HexKey>): Shelter {
  if (squishy.state !== 'active') return 'hollowed';
  if (squishy.post !== null && isOnWatch(squishy, squishy.post)) {
    return safe.has(hexKey(squishy.post.at)) ? 'on-watch' : 'exposed';
  }
  if (squishy.sleepsAt !== null && safe.has(hexKey(squishy.sleepsAt))) return 'safe';
  return 'exposed';
}

/** A total order on ids, so the pick never depends on the order rows came in. */
const byId = (a: { readonly id: string }, b: { readonly id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * "He only needs one": the squishy taken from one player's exposed ones, or
 * null if none are exposed. Deterministic for a seed (derived on the server
 * and never revealed), whatever order the squishies are listed in.
 */
export function pickTaken(exposed: readonly { readonly id: string }[], seed: Seed): string | null {
  if (exposed.length === 0) return null;
  return Rng.fromSeed(seed).pick([...exposed].sort(byId)).id;
}

/** What nightfall did to one player. */
export interface NightfallOutcome {
  readonly userId: string;
  /** The squishy taken to the Hollow, or null. */
  readonly taken: string | null;
  /** Their squishies left in the dark, guards out there included (the taken one too). */
  readonly exposed: number;
  /** Their squishies kept safe: by a lit fire, or standing watch. */
  readonly sheltered: number;
}

/**
 * "…but never your last friend" (owner decision 2026-10-05, design doc §14):
 * the Hollow Man takes nothing from a player with fewer than this many
 * active squishies, so there's always someone to play with, and to go and
 * rescue the others. A rule the design doc fixes, so a literal, not a tunable.
 */
export const LEAST_ACTIVE_TO_TAKE_FROM = 2;

/** True if the Hollow Man may take from a player with this many active squishies. */
export function mayTakeFrom(activeCount: number): boolean {
  return activeCount >= LEAST_ACTIVE_TO_TAKE_FROM;
}

/**
 * One nightfall for every player on a map: at most one squishy per player
 * (design doc §14), never a protected one, never a player's last active one,
 * and nothing from a player in their first-night grace. `canTake` is false
 * where the Hollow Man takes nothing (`gameplayOverrides(kind).hollowManCanTake`);
 * `seedFor` gives each player's secret seed for the night.
 */
export function nightfall(
  players: readonly {
    readonly userId: string;
    readonly squishies: readonly NightSquishy[];
    /** Still in their first-night grace (`firstHollowNight`): nothing is taken from them. */
    readonly grace?: boolean;
  }[],
  safe: ReadonlySet<HexKey>,
  seedFor: (userId: string) => Seed,
  canTake: boolean,
): NightfallOutcome[] {
  return players.map(({ userId, squishies, grace = false }) => {
    const mine = squishies.filter((s) => s.ownerUserId === userId);
    const shelters = mine.map((s) => ({ squishy: s, shelter: shelterOf(s, safe) }));
    const exposed = shelters.filter((s) => s.shelter === 'exposed').map((s) => s.squishy);
    const sheltered = shelters.filter(
      (s) => s.shelter === 'safe' || s.shelter === 'on-watch',
    ).length;
    // Active anywhere (exposed, safe or on watch): the friends they still have.
    const active = shelters.filter((s) => s.shelter !== 'hollowed').length;
    return {
      userId,
      taken: canTake && !grace && mayTakeFrom(active) ? pickTaken(exposed, seedFor(userId)) : null,
      exposed: exposed.length,
      sheltered,
    };
  });
}

/** Heartdust a rescue earns, given how many rescues earned it today (decision C cap). */
export function rescueReward(rewardedToday: number, rules: Pick<HollowRules, 'rescue'>): number {
  return rewardedToday < rules.rescue.rewardsPerDay ? rules.rescue.heartdust : 0;
}
