import { hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import { addDays, daysBetween } from '../home/local-date.js';
import { tonightOf, type MapLocalTime } from '../home/hearthfire.js';
import { Rng, type Seed } from '../rng/index.js';
import type { HollowRules, HollowStage, HollowStrengthRules } from '../schemas/data/hollow.js';
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

/** The night of the latest nightfall at or before `local` (yesterday's before nightfall). */
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
 * after joining are skipped (owner decision 2026-10-03). Joining at 6:55 PM
 * makes that evening's nightfall the first of them; joining at 7:00 PM or
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
 * The squishy taken from one player's exposed ones, or null if none are
 * exposed. Deterministic for a seed (derived on the server and never
 * revealed), whatever order the squishies are listed in.
 */
export function pickTaken(exposed: readonly { readonly id: string }[], seed: Seed): string | null {
  return pickTakenMany(exposed, seed, 1)[0] ?? null;
}

/**
 * Up to `count` of one player's exposed squishies, without repeats (#277: a
 * bolder Hollow Man strikes more than once). The first is `pickTaken`'s.
 */
export function pickTakenMany(
  exposed: readonly { readonly id: string }[],
  seed: Seed,
  count: number,
): string[] {
  const left = [...exposed].sort(byId);
  if (left.length === 0 || count < 1) return [];
  const rng = Rng.fromSeed(seed);
  const taken: string[] = [];
  while (taken.length < count && left.length > 0) {
    const i = rng.int(0, left.length - 1);
    taken.push((left[i] as { readonly id: string }).id);
    left.splice(i, 1);
  }
  return taken;
}

/** What nightfall did to one player. */
export interface NightfallOutcome {
  readonly userId: string;
  /** The squishies taken to the Hollow (none, or up to the night's strikes). */
  readonly taken: readonly string[];
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
 * One nightfall for every player on a map: up to each player's `strikes`
 * squishies (#277; 1 when not given, design doc §14's "he only needs one"),
 * never a protected one, never a player's last active one, and nothing from
 * a player in their first-night grace. `canTake` is false where the Hollow
 * Man takes nothing (`gameplayOverrides(kind).hollowManCanTake`); `seedFor`
 * gives each player's secret seed for the night.
 */
export function nightfall(
  players: readonly {
    readonly userId: string;
    readonly squishies: readonly NightSquishy[];
    /** Still in their first-night grace (`firstHollowNight`): nothing is taken from them. */
    readonly grace?: boolean;
    /** How many times he strikes this player tonight (`rollStrikes`). */
    readonly strikes?: number;
  }[],
  safe: ReadonlySet<HexKey>,
  seedFor: (userId: string) => Seed,
  canTake: boolean,
): NightfallOutcome[] {
  return players.map(({ userId, squishies, grace = false, strikes = 1 }) => {
    const mine = squishies.filter((s) => s.ownerUserId === userId);
    const shelters = mine.map((s) => ({ squishy: s, shelter: shelterOf(s, safe) }));
    const exposed = shelters.filter((s) => s.shelter === 'exposed').map((s) => s.squishy);
    const sheltered = shelters.filter(
      (s) => s.shelter === 'safe' || s.shelter === 'on-watch',
    ).length;
    // Active anywhere (exposed, safe or on watch): the friends they still have.
    const active = shelters.filter((s) => s.shelter !== 'hollowed').length;
    // Each take must leave a friend behind: at most `active - 1` in all.
    const most = canTake && !grace && mayTakeFrom(active) ? Math.min(strikes, active - 1) : 0;
    return {
      userId,
      taken: pickTakenMany(exposed, seedFor(userId), most),
      exposed: exposed.length,
      sheltered,
    };
  });
}

type StrengthRules = Pick<HollowRules, 'strength'>;

/**
 * A Keeper's night on a patch (#277): 1 for the first nightfall after they
 * joined (`tonightOf` their joining), 2 for the next, and so on. 0 or less
 * for a night before they joined.
 */
export function keeperNightOf(
  joined: MapLocalTime,
  night: LocalDate,
  rules: NightfallRules,
): number {
  return daysBetween(tonightOf(joined, rules), night) + 1;
}

/** The strength row for a Keeper's night: the last whose `from` has come (the first before night 1). */
export function strengthOf(
  keeperNight: number,
  rules: StrengthRules,
): HollowStrengthRules['nights'][number] {
  const rows = rules.strength.nights;
  let row = rows[0] as HollowStrengthRules['nights'][number];
  for (const r of rows) if (r.from <= keeperNight) row = r;
  return row;
}

/** The moon stage kids see for a Keeper's night. */
export function stageOf(keeperNight: number, rules: StrengthRules): HollowStage {
  return strengthOf(keeperNight, rules).stage;
}

/**
 * How many times the Hollow Man strikes a Keeper tonight (#277): each of the
 * row's chances, scaled by the patch's `percent` (the admin console's
 * "Hollow Man strength", 100 by default, owner decision 2026-10-08 Q4) and
 * kept at 100 at most, rolled in order until one misses; never more than
 * `cap`. Deterministic for a seed (secret, from the map seed).
 */
export function rollStrikes(
  chances: readonly number[],
  percent: number,
  cap: number,
  seed: Seed,
): number {
  const rng = Rng.fromSeed(seed);
  let strikes = 0;
  for (const chance of chances) {
    if (strikes >= cap) break;
    // Whole percent, rounded down: integer maths only (tech spec §8).
    const scaled = Math.min(100, Math.floor((chance * percent) / 100));
    if (scaled <= 0 || !rng.chance(scaled)) break;
    strikes++;
  }
  return strikes;
}

/**
 * The dark tiles he wins back tonight (#277): the `count` farthest from the
 * Keeper's Heart Seed, ties by tile id. The caller passes only tiles he may
 * take (owned, not home, not lit, not fresh, not unlightable, not cooling
 * down after a battle).
 */
export function pickReclaimed<
  T extends { readonly id: string; readonly q: number; readonly r: number },
>(tiles: readonly T[], heartSeed: Hex | null, count: number): T[] {
  if (count < 1) return [];
  const from = heartSeed ?? { q: 0, r: 0 };
  return [...tiles]
    .sort((a, b) => {
      const d = hexDistance(b, from) - hexDistance(a, from);
      return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, count);
}

/**
 * Was this tile claimed since the last nightfall? A freshly claimed tile is
 * safe on its first night (#277 guardrail b). `claimed` is when it was
 * claimed, map-local; null for land held before claiming was recorded.
 */
export function isFreshTile(
  claimed: MapLocalTime | null,
  night: LocalDate,
  rules: NightfallRules,
): boolean {
  return claimed !== null && tonightOf(claimed, rules) >= night;
}

/** One stop on the Hollow Man's walk along a Keeper's border (#277), for the client's show. */
export interface WalkPoint {
  readonly q: number;
  readonly r: number;
  /** `enter` and `leave` start and end the walk; `recoil`: a lit tile turns him back; `strike`: a dark one he reaches. */
  readonly kind: 'enter' | 'recoil' | 'strike' | 'leave';
}

/** Most lit tiles he backs away from on one walk. */
const WALK_RECOILS = 3;

/**
 * A monotonic stand-in for the angle of a hex around `from` (0 up to 4),
 * with no trigonometry (tech spec §8). Only orders the walk.
 */
function turnOf(h: Hex, from: Hex): number {
  const x = 2 * (h.q - from.q) + (h.r - from.r);
  const y = (h.r - from.r) * 1.75;
  const sum = Math.abs(x) + Math.abs(y);
  if (sum === 0) return 0;
  const p = x / sum;
  return y < 0 ? 3 + p : 1 - p;
}

/**
 * The Hollow Man's walk along one Keeper's border (#277), which the client
 * plays from 7:00 to 7:30 PM and in the morning replay. Not secret: lit
 * tiles and land are public. He backs away from up to 3 lit border tiles
 * (picked with `seed`) and reaches each struck tile, going round the Heart
 * Seed; `enter` and `leave` sit on the first and last stop. Empty if there's
 * nowhere to walk.
 */
export function hollowWalk(input: {
  /** All the Keeper's tiles, home included. */
  readonly land: readonly Hex[];
  /** Tiles safe tonight (lit, home, fresh). */
  readonly safe: ReadonlySet<HexKey>;
  /** Tiles he struck: those he won back and those where he took a squishy. */
  readonly strikes: readonly Hex[];
  readonly heartSeed: Hex | null;
  readonly seed: Seed;
}): WalkPoint[] {
  const mine = new Set(input.land.map(hexKey));
  const border = input.land
    .filter((h) => hexNeighbors(h).some((n) => !mine.has(hexKey(n))))
    .sort((a, b) => a.q - b.q || a.r - b.r);
  const struck = new Set(input.strikes.map(hexKey));
  const lit = border.filter((h) => input.safe.has(hexKey(h)) && !struck.has(hexKey(h)));
  const rng = Rng.fromSeed(input.seed);
  const recoils: Hex[] = [];
  while (recoils.length < WALK_RECOILS && lit.length > 0) {
    recoils.push(lit.splice(rng.int(0, lit.length - 1), 1)[0] as Hex);
  }
  const unique = new Map<HexKey, Hex>();
  for (const h of input.strikes) unique.set(hexKey(h), h);
  const from = input.heartSeed ?? input.land[0] ?? { q: 0, r: 0 };
  const start = rng.int(0, 3);
  const stops = [
    ...recoils.map((h) => ({ h, kind: 'recoil' as const })),
    ...[...unique.values()].map((h) => ({ h, kind: 'strike' as const })),
  ]
    .map((s) => ({ ...s, turn: (turnOf(s.h, from) - start + 4) % 4 }))
    .sort((a, b) => a.turn - b.turn || a.h.q - b.h.q || a.h.r - b.h.r);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return [];
  return [
    { q: first.h.q, r: first.h.r, kind: 'enter' },
    ...stops.map((s) => ({ q: s.h.q, r: s.h.r, kind: s.kind })),
    { q: last.h.q, r: last.h.r, kind: 'leave' },
  ];
}

/** Heartdust a rescue earns, given how many rescues earned it today (decision C cap). */
export function rescueReward(rewardedToday: number, rules: Pick<HollowRules, 'rescue'>): number {
  return rewardedToday < rules.rescue.rewardsPerDay ? rules.rescue.heartdust : 0;
}
