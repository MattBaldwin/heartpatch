import { hexDistance, type Hex } from '../hex/index.js';
import type { TerritoryRules } from '../schemas/data/territory.js';
import type { PvpMode } from '../schemas/maps.js';

// Land that misses you (owner decision 2026-10-06, design review Q2). An
// outer tile remembers when its owner last tended it: claimed it, or tapped
// Visit, which tends all of their land at once. Nothing ticks (CLAUDE.md
// rule 4). Untended for `missesYouAfterDays` it fades and the owner is told;
// untended for `wildAfterDays` it can go wild again at a nightfall, a few of
// a player's tiles a night, farthest from home first, and its guardians come
// back. Home tiles and the ring around them never fade. Pure: the server
// passes in when each tile was last tended.

type TendingRules = TerritoryRules['tending'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How an owned tile feels about its owner:
 * - `happy`: tended lately (or a tile that never fades).
 * - `misses-you`: untended a while; it's fading, and the owner is told.
 * - `going-wild`: untended long enough to go wild at the next nightfall.
 */
export type LandMood = 'happy' | 'misses-you' | 'going-wild';

export function landMood(tendedAt: Date, now: Date, rules: TendingRules): LandMood {
  const age = now.getTime() - tendedAt.getTime();
  if (age >= rules.wildAfterDays * DAY_MS) return 'going-wild';
  if (age >= rules.missesYouAfterDays * DAY_MS) return 'misses-you';
  return 'happy';
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
  const start = missesYouAt(tendedAt, rules).getTime();
  const end = wildFrom(tendedAt, rules).getTime();
  const at = now.getTime();
  if (at <= start) return 0;
  if (at >= end) return 100;
  return Math.floor(((at - start) * 100) / (end - start));
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
}

/**
 * The tiles that go wild at a nightfall at `now`: for each owner, up to
 * `perOwner` of their fading-eligible tiles untended for `wildAfterDays`,
 * farthest from their Heart Seed first (land shrinks from its edges), then
 * the longest untended, then by position so the pick is always the same.
 */
export function tilesGoingWild<T extends TendingTile>(
  tiles: readonly T[],
  heartSeeds: ReadonlyMap<string, Hex | null>,
  now: Date,
  perOwner: number,
  rules: TendingRules,
): T[] {
  const byOwner = new Map<string, { tile: T; distance: number }[]>();
  for (const tile of tiles) {
    const seed = heartSeeds.get(tile.ownerUserId) ?? null;
    if (!canFade(tile, seed, rules)) continue;
    if (landMood(tile.tendedAt, now, rules) !== 'going-wild') continue;
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
