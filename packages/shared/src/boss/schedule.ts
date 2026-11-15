import type { BossBagEntry, BossEventRules } from '../schemas/data/boss-events.js';
import type { LocalDate } from '../schemas/time.js';
import { addDays, localDateToDays } from '../home/local-date.js';
import { weekdayOf } from '../long-night/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import { hexDistance, type Hex } from '../hex/index.js';

/** Days in a week; a patch gets at most one visit a week. */
const WEEK = 7;
/** 1970-01-05 was the first Monday of the epoch. */
const FIRST_MONDAY = 4;

/** The patch-local Monday of `date`'s week: a visit's window id (#190). */
export function bossWeekOf(date: LocalDate): LocalDate {
  const days = localDateToDays(date);
  const sinceMonday = (((days - FIRST_MONDAY) % WEEK) + WEEK) % WEEK;
  return addDays(date, -sinceMonday);
}

/** Weeks since the epoch's first Monday, for the bag's cycle. */
function weekIndex(week: LocalDate): number {
  return Math.floor((localDateToDays(week) - FIRST_MONDAY) / WEEK);
}

/** A seeded Fisher–Yates shuffle (a copy). */
function shuffled<T>(items: readonly T[], seed: Seed): T[] {
  const rng = Rng.fromSeed(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return out;
}

/** A week's visit, in patch-local time; the server turns it into instants. */
export interface BossVisitPlan {
  boss: BossBagEntry;
  /** The patch-local date it opens on, at `rules.opensAtHour`. */
  opensOn: LocalDate;
}

/**
 * Which boss visits a patch in `week`, and on which day (#190 plan §2): a
 * seeded shuffle bag, so every boss visits before one repeats, and a seeded
 * start day whose visit never covers the patch's Long Night (a visit opening
 * on day d spans the nightfalls of d and d + 1). Pure: the same map seed and
 * week always give the same visit. Null with an empty bag.
 */
export function bossVisitFor(
  mapSeed: Seed,
  week: LocalDate,
  longNightWeekday: number | null,
  rules: Pick<BossEventRules, 'bag' | 'windowHours'>,
): BossVisitPlan | null {
  if (rules.bag.length === 0) return null;
  const index = weekIndex(week);
  const cycle = Math.floor(index / rules.bag.length);
  const bag = shuffled(rules.bag, deriveSeed(mapSeed, 'boss-bag', cycle));
  const boss = bag[index % rules.bag.length];
  if (!boss) return null;
  // Days the visit fully fits inside the week and misses the Long Night.
  const spanDays = Math.ceil(rules.windowHours / 24);
  const days: LocalDate[] = [];
  for (let offset = 0; offset + spanDays < WEEK; offset++) {
    const day = addDays(week, offset);
    const nights = Array.from({ length: spanDays }, (_, i) => weekdayOf(addDays(day, i)));
    if (longNightWeekday === null || !nights.includes(longNightWeekday)) days.push(day);
  }
  if (days.length === 0) return null;
  const opensOn = Rng.fromSeed(deriveSeed(mapSeed, 'boss-day', week)).pick(days);
  return { boss, opensOn };
}

/** A tile a boss could stand on: neutral land, with its terrain. */
export interface BossTileCandidate extends Hex {
  terrain: string;
}

/**
 * Where a boss stands (#190 plan §2): among the candidates (neutral land,
 * picked by the caller), those whose terrain the boss likes if any, and of
 * those the tiles whose farthest member home is nearest (fair to everyone);
 * the seed breaks ties. Null with no candidates.
 */
export function bossTileFor(
  mapSeed: Seed,
  week: LocalDate,
  boss: BossBagEntry,
  candidates: readonly BossTileCandidate[],
  homes: readonly Hex[],
): Hex | null {
  if (candidates.length === 0) return null;
  const liked = candidates.filter((t) => boss.terrains.includes(t.terrain));
  const pool = liked.length > 0 ? liked : candidates;
  const farthest = (t: Hex) => Math.max(0, ...homes.map((h) => hexDistance(t, h)));
  const best = Math.min(...pool.map(farthest));
  const fair = pool.filter((t) => farthest(t) === best).sort((a, b) => a.q - b.q || a.r - b.r);
  const pick = Rng.fromSeed(deriveSeed(mapSeed, 'boss-tile', week)).pick(fair);
  return { q: pick.q, r: pick.r };
}

/** The boss's level for one Keeper (#190 plan §2): their Partner's plus a bonus, with a floor. */
export function bossLevelFor(
  partnerLevel: number,
  rules: Pick<BossEventRules, 'levelBonus' | 'minLevel'>,
  maxLevel: number,
): number {
  return Math.min(maxLevel, Math.max(rules.minLevel, partnerLevel + rules.levelBonus));
}
