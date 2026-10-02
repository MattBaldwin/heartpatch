import { hexKey, type Hex, type HexKey } from '../hex/index.js';
import { addDays } from '../home/local-date.js';
import type { MapLocalTime } from '../home/hearthfire.js';
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

/** The night of the latest nightfall at or before `local` (yesterday's before 9 PM). */
export function lastNightOf(local: MapLocalTime, rules: NightfallRules): LocalDate {
  return local.minute >= rules.nightfallMinute ? local.date : addDays(local.date, -1);
}

/** Is `a` earlier than `b`? Map-local wall-clock times on the same map. */
export function isLocalBefore(a: MapLocalTime, b: MapLocalTime): boolean {
  return a.date < b.date || (a.date === b.date && a.minute < b.minute);
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
  /** The tile it stands watch on, if it's posted (decision C). */
  readonly post: WatchPost | null;
}

/**
 * Where a squishy stands at nightfall:
 * - `hollowed`: already in the Hollow;
 * - `on-watch`: guarding its owner's land, so not exposed (decision C);
 * - `safe`: it sleeps inside a lit Hearthfire's safe tiles;
 * - `exposed`: the Hollow Man may take it.
 */
export type Shelter = 'hollowed' | 'on-watch' | 'safe' | 'exposed';

/** `safe`: every tile lit fires protect tonight (`safeTiles` / `litSafeTiles`). */
export function shelterOf(squishy: NightSquishy, safe: ReadonlySet<HexKey>): Shelter {
  if (squishy.state !== 'active') return 'hollowed';
  if (isOnWatch(squishy, squishy.post)) return 'on-watch';
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
  /** Their squishies left at home in the dark (the taken one included). */
  readonly exposed: number;
  /** Their squishies kept safe: by a lit fire, or standing watch. */
  readonly sheltered: number;
}

/**
 * One nightfall for every player on a map: at most one squishy per player
 * (design doc §14), never a protected one. `canTake` is false where the
 * Hollow Man takes nothing (`gameplayOverrides(kind).hollowManCanTake`);
 * `seedFor` gives each player's secret seed for the night.
 */
export function nightfall(
  players: readonly { readonly userId: string; readonly squishies: readonly NightSquishy[] }[],
  safe: ReadonlySet<HexKey>,
  seedFor: (userId: string) => Seed,
  canTake: boolean,
): NightfallOutcome[] {
  return players.map(({ userId, squishies }) => {
    const mine = squishies.filter((s) => s.ownerUserId === userId);
    const shelters = mine.map((s) => ({ squishy: s, shelter: shelterOf(s, safe) }));
    const exposed = shelters.filter((s) => s.shelter === 'exposed').map((s) => s.squishy);
    const sheltered = shelters.filter(
      (s) => s.shelter === 'safe' || s.shelter === 'on-watch',
    ).length;
    return {
      userId,
      taken: canTake ? pickTaken(exposed, seedFor(userId)) : null,
      exposed: exposed.length,
      sheltered,
    };
  });
}

/** Heartdust a rescue earns, given how many rescues earned it today (decision C cap). */
export function rescueReward(rewardedToday: number, rules: Pick<HollowRules, 'rescue'>): number {
  return rewardedToday < rules.rescue.rewardsPerDay ? rules.rescue.heartdust : 0;
}
