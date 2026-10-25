import { hexDistance, type Hex } from '../hex/index.js';
import type { TerritoryRules } from '../schemas/data/territory.js';
import type { TravelRules } from '../schemas/data/travel.js';
import type { PvpMode } from '../schemas/maps.js';

// Land that misses you (owner decision 2026-10-06, design review Q2). An
// outer tile remembers when its owner last tended it: claimed it, or tapped
// Visit, which tends all of their land at once. Nothing ticks (CLAUDE.md
// rule 4). Untended for `missesYouAfterDays` it fades and the owner is told;
// untended for `wildAfterDays` it can go wild again at a nightfall, a few of
// a player's tiles a night, farthest from home first, and its guardians come
// back. Home tiles and the ring around them never fade. Pure: the server
// passes in when each tile was last tended.
//
// Wild Isle (#621) adds a second clock: land cut off from home (not in its
// owner's `supplyMap`) is stranded from `stranded_since`, fades at once and
// can go wild `afterHours` later. Whichever clock ends first is the one a
// tile fades by. A Cozy Patch passes no stranded rules and never strands.

type TendingRules = TerritoryRules['tending'];
type StrandedRules = TravelRules['stranded'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How an owned tile feels about its owner:
 * - `happy`: tended lately (or a tile that never fades).
 * - `misses-you`: untended a while; it's fading, and the owner is told.
 * - `going-wild`: untended long enough to go wild at the next nightfall.
 */
export type LandMood = 'happy' | 'misses-you' | 'going-wild';

export function landMood(tendedAt: Date, now: Date, rules: TendingRules): LandMood {
  return clockMood(tendingClock(tendedAt, rules), now);
}

/**
 * A fading clock: from `start` the tile misses its owner, from `end` it can
 * go wild at a nightfall. `stranded`: it's the Wild Isle's cut-off clock.
 */
export interface FadeClock {
  readonly start: Date;
  readonly end: Date;
  readonly stranded: boolean;
}

/** The tending clock: untended land misses you, then goes wild. */
export function tendingClock(tendedAt: Date, rules: TendingRules): FadeClock {
  return { start: missesYouAt(tendedAt, rules), end: wildFrom(tendedAt, rules), stranded: false };
}

/** The stranded clock (Wild Isle, #621): it fades from `since`, wild `afterHours` later. */
export function strandedClock(since: Date, rules: StrandedRules): FadeClock {
  return {
    start: since,
    end: new Date(since.getTime() + rules.afterHours * HOUR_MS),
    stranded: true,
  };
}

/**
 * The clock a tile fades by: its tending clock, or its stranded clock when
 * it's stranded (`strandedSince` set, stranded rules given) and that one
 * lets it go wild first. Equal ends keep the tending clock.
 */
export function fadeClock(
  tendedAt: Date,
  strandedSince: Date | null,
  rules: TendingRules,
  stranded: StrandedRules | null,
): FadeClock {
  const tending = tendingClock(tendedAt, rules);
  if (strandedSince === null || stranded === null) return tending;
  const cutOff = strandedClock(strandedSince, stranded);
  return cutOff.end.getTime() < tending.end.getTime() ? cutOff : tending;
}

/** How a tile on `clock` feels at `now`. */
export function clockMood(clock: FadeClock, now: Date): LandMood {
  if (now.getTime() >= clock.end.getTime()) return 'going-wild';
  if (now.getTime() >= clock.start.getTime()) return 'misses-you';
  return 'happy';
}

/** How far into fading a tile on `clock` is at `now`, 0 to 100. */
export function clockFadePercent(clock: FadeClock, now: Date): number {
  const start = clock.start.getTime();
  const end = clock.end.getTime();
  const at = now.getTime();
  if (at <= start) return 0;
  if (at >= end) return 100;
  return Math.floor(((at - start) * 100) / (end - start));
}

/** When a tile tended at `tendedAt` starts to miss its owner. */
export function missesYouAt(tendedAt: Date, rules: TendingRules): Date {
  return new Date(tendedAt.getTime() + rules.missesYouAfterDays * DAY_MS);
}

/** From when a tile tended at `tendedAt` can go wild (at the first nightfall after it). */
export function wildFrom(tendedAt: Date, rules: TendingRules): Date {
  return new Date(tendedAt.getTime() + rules.wildAfterDays * DAY_MS);
}

/** How far into fading a tile is, 0 (just started) to 100 (going wild), for the map's tint. */
export function fadePercent(tendedAt: Date, now: Date, rules: TendingRules): number {
  return clockFadePercent(tendingClock(tendedAt, rules), now);
}

/** Whether a tile can ever fade: not a home tile, and outside the kept ring round its owner's Heart Seed. */
export function canFade(
  tile: Hex & { readonly homeSlot: number | null },
  heartSeed: Hex | null,
  rules: TendingRules,
): boolean {
  if (tile.homeSlot !== null) return false;
  return heartSeed === null || hexDistance(tile, heartSeed) > rules.keepRadius;
}

/** How many of one player's tiles can go wild at one nightfall. */
export function wildPerNight(rules: TendingRules, pvpMode: PvpMode): number {
  return rules.wildPerNight[pvpMode];
}

/** An owned tile, as `tilesGoingWild` needs it. */
export interface TendingTile extends Hex {
  readonly ownerUserId: string;
  readonly homeSlot: number | null;
  /** When its owner last tended it (claiming counts). */
  readonly tendedAt: Date;
  /** Wild Isle (#621): cut off from home since then; null or unset: supplied. */
  readonly strandedSince?: Date | null;
}

/**
 * The tiles that go wild at a nightfall at `now`: for each owner, up to
 * `perOwner` of their fading-eligible tiles untended for `wildAfterDays`,
 * farthest from their Heart Seed first (land shrinks from its edges), then
 * the longest untended, then by position so the pick is always the same.
 * With a Wild Isle's `stranded` rules (#621), stranded land whose cut-off
 * clock ends first goes by that clock, under the same per-owner cap.
 */
export function tilesGoingWild<T extends TendingTile>(
  tiles: readonly T[],
  heartSeeds: ReadonlyMap<string, Hex | null>,
  now: Date,
  perOwner: number,
  rules: TendingRules,
  stranded: StrandedRules | null = null,
): T[] {
  const byOwner = new Map<string, { tile: T; distance: number }[]>();
  for (const tile of tiles) {
    const seed = heartSeeds.get(tile.ownerUserId) ?? null;
    if (!canFade(tile, seed, rules)) continue;
    const clock = fadeClock(tile.tendedAt, tile.strandedSince ?? null, rules, stranded);
    if (clockMood(clock, now) !== 'going-wild') continue;
    const distance = seed === null ? 0 : hexDistance(tile, seed);
    byOwner.set(tile.ownerUserId, [...(byOwner.get(tile.ownerUserId) ?? []), { tile, distance }]);
  }
  const going: T[] = [];
  for (const owner of [...byOwner.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const picked = (byOwner.get(owner) ?? [])
      .sort(
        (a, b) =>
          b.distance - a.distance ||
          a.tile.tendedAt.getTime() - b.tile.tendedAt.getTime() ||
          a.tile.q - b.tile.q ||
          a.tile.r - b.tile.r,
      )
      .slice(0, perOwner);
    going.push(...picked.map((p) => p.tile));
  }
  return going;
}
