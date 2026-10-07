import { EXPLORE_RULES } from '../../src/data/explore.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { RESOURCES } from '../../src/data/resources.js';
import { homesteadQuantity, homesteadStates, searchSpots } from '../../src/explore/index.js';
import { hexBfs, hexFromKey, hexKey, type HexKey } from '../../src/hex/index.js';
import { workCycleSeconds, workProgress, workSource } from '../../src/jobs/index.js';
import type { MapTile } from '../../src/mapgen/index.js';
import type { ExploreRules } from '../../src/schemas/data/explore.js';
import type { EconomyProfile } from './economy-config.js';
import { sessionGapsMs } from './fuel.js';

/*
 * What homesteads add to a kid's gathering (#199, owner decision 2026-10-07
 * Q6). Land comes from `pnpm sim:progression` (the tiles a kid owns each
 * day). Each day the kid searches `searchesPerDay` spots, nearest land to
 * home first, using the real search-spot generator; a fully explored tile
 * next to home (or another homestead) joins as a homestead
 * (`homesteadStates`). Then a day of gathering with the real rules, once
 * as if homesteads gave nothing extra and once with their bigger yield
 * (`homesteadQuantity` on every cycle a homestead gives):
 *
 * - the Keeper starts one gather on each of their best `keeperNodes` nodes
 *   every session; it lands at the next session if it has finished;
 * - each gatherer works one of the best spots the kid owns (a node, or
 *   land's yield) and banks its cycles at every session, capped at
 *   `maxStoredCycles` (`workProgress`, the server's own maths).
 */

/** What the model leaves out, for the report. */
export const ECONOMY_LIMITS = [
  'the kid plays every day at the same hours',
  'the kid always has the tools a spot needs (crafting them is not counted)',
  'what searches find is not counted: only gathering',
  'no captures between the kids, so no homestead is ever cut off',
  'seasonal yields (Pumpkins) count all year',
  'gatherers have no element or feeling match (100 % speed)',
  'the kid explores the land nearest home first, not where their gatherers would earn most',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each tile's spot count and how many the kid has searched. */
export type ExploreProgress = Map<HexKey, { spots: number; searched: number }>;

/** The kid's owned tiles, nearest to home first (steps through their own land, then key). */
function nearestFirst(land: readonly HexKey[], tiles: ReadonlyMap<HexKey, MapTile>): MapTile[] {
  const owned = new Set(land);
  const home = land.map((k) => tiles.get(k)).filter((t) => t?.homeSlot != null) as MapTile[];
  const steps = hexBfs(home, (h) => owned.has(hexKey(h)));
  return land
    .map((k) => tiles.get(k))
    .filter((t): t is MapTile => t !== undefined && t.homeSlot === null)
    .sort((a, b) => {
      const da = steps.get(hexKey(a)) ?? Infinity;
      const db = steps.get(hexKey(b)) ?? Infinity;
      return da - db || (hexKey(a) < hexKey(b) ? -1 : 1);
    });
}

/** One day of exploring: spends `profile.searchesPerDay` on the nearest unfinished tiles. */
export function exploreDay(
  progress: ExploreProgress,
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  mapSeed: string,
  profile: Pick<EconomyProfile, 'searchesPerDay'>,
): void {
  let budget = profile.searchesPerDay;
  for (const tile of nearestFirst(land, tiles)) {
    if (budget <= 0) return;
    const key = hexKey(tile);
    let entry = progress.get(key);
    if (!entry) {
      const spots = searchSpots(mapSeed, tile, EXPLORE_RULES);
      if (!spots) continue;
      entry = { spots: spots.length, searched: 0 };
      progress.set(key, entry);
    }
    const searched = Math.min(entry.spots - entry.searched, budget);
    entry.searched += searched;
    budget -= searched;
  }
}

/** The kid's joined homesteads. */
export function homesteadsOf(
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  progress: ExploreProgress,
): Set<HexKey> {
  const owned = new Set(land);
  const view = [...tiles.values()].map((t) => ({
    q: t.q,
    r: t.r,
    homeSlot: t.homeSlot,
    ownerUserId: owned.has(hexKey(t)) ? 'kid' : null,
  }));
  const rows = [...progress].map(([key, p]) => ({
    ...hexFromKey(key),
    completed: p.searched >= p.spots,
    joined: false,
    paused: false,
  }));
  const states = homesteadStates(view, rows, 'kid');
  return new Set([...states].filter(([, s]) => s === 'joined').map(([k]) => k));
}

/** Somewhere to gather, and whether it's a homestead. */
export interface GatherSpot {
  readonly resource: string;
  readonly quantity: number;
  /** The Keeper-equivalent gather time. */
  readonly seconds: number;
  readonly from: 'node' | 'land';
  readonly homestead: boolean;
}

export function gatherSpots(
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  homesteads: ReadonlySet<HexKey>,
): GatherSpot[] {
  const spots: GatherSpot[] = [];
  for (const key of land) {
    const tile = tiles.get(key);
    if (!tile) throw new Error(`no tile ${key}`);
    const source = workSource(tile, RESOURCES, JOB_RULES);
    if (source) spots.push({ ...source, homestead: homesteads.has(key) });
  }
  return spots;
}

/** The homestead bonus, or none (`null`: every spot gives its usual yield). */
export type HomesteadBonus = Pick<ExploreRules, 'homestead'> | null;

/** What one finished cycle (or Keeper gather) on a spot gives. */
function quantityOf(spot: GatherSpot, bonus: HomesteadBonus): number {
  return bonus && spot.homestead ? homesteadQuantity(spot.quantity, bonus) : spot.quantity;
}

export type Income = Readonly<Record<string, number>>;

function add(into: Record<string, number>, resource: string, n: number): void {
  if (n > 0) into[resource] = (into[resource] ?? 0) + n;
}

/** What one gatherer banks on a spot in a day, settled at every session. */
function gathererDay(
  profile: Pick<EconomyProfile, 'sessions'>,
  spot: GatherSpot,
  bonus: HomesteadBonus,
): number {
  const cycle = workCycleSeconds(spot.seconds, 100, JOB_RULES);
  let banked = 0;
  let since = 0;
  let at = 0;
  for (const gap of sessionGapsMs(profile.sessions)) {
    at += gap;
    const done = workProgress(since, at, cycle, JOB_RULES);
    banked += done.cycles * quantityOf(spot, bonus);
    since = done.nextSinceMs;
  }
  if (at !== DAY_MS) throw new Error('sessions must fit in one day');
  return banked;
}

/** What the Keeper's gathers on a node bring in a day: one per finished session gap. */
function keeperDay(
  profile: Pick<EconomyProfile, 'sessions'>,
  node: GatherSpot,
  bonus: HomesteadBonus,
): number {
  const landed = sessionGapsMs(profile.sessions).filter((gap) => gap >= node.seconds * 1000);
  return landed.length * quantityOf(node, bonus);
}

/**
 * The `count` spots that bank the most in a day for this kid (the stored
 * cycle cap included, so a quick spot isn't always best), then what they bank.
 */
function bestDay(
  spots: readonly GatherSpot[],
  count: number,
  perDay: (spot: GatherSpot) => number,
): { income: Income; picked: GatherSpot[] } {
  const income: Record<string, number> = {};
  const ranked = spots
    .map((spot, i) => ({ spot, i, banked: perDay(spot) }))
    .sort((a, b) => b.banked - a.banked || a.i - b.i)
    .slice(0, count);
  for (const { spot, banked } of ranked) add(income, spot.resource, banked);
  return { income, picked: ranked.map((r) => r.spot) };
}

/** What the kid's gatherers bank in a day, each on one of the best spots. */
export function gatherersPerDay(
  profile: Pick<EconomyProfile, 'gatherers' | 'sessions'>,
  spots: readonly GatherSpot[],
  bonus: HomesteadBonus,
): Income {
  return bestDay(spots, profile.gatherers, (s) => gathererDay(profile, s, bonus)).income;
}

/** How many of the kid's gatherers work a homestead (they go where they bank the most). */
export function gatherersOnHomesteads(
  profile: Pick<EconomyProfile, 'gatherers' | 'sessions'>,
  spots: readonly GatherSpot[],
  bonus: HomesteadBonus,
): number {
  const { picked } = bestDay(spots, profile.gatherers, (s) => gathererDay(profile, s, bonus));
  return picked.filter((s) => s.homestead).length;
}

/** What the Keeper's own gathers bring in a day, on their best `keeperNodes` nodes. */
export function keeperPerDay(
  profile: Pick<EconomyProfile, 'keeperNodes' | 'sessions'>,
  spots: readonly GatherSpot[],
  bonus: HomesteadBonus,
): Income {
  const nodes = spots.filter((s) => s.from === 'node');
  return bestDay(nodes, profile.keeperNodes, (s) => keeperDay(profile, s, bonus)).income;
}

/** One kid on one day. */
export interface EconomyDay {
  readonly day: number;
  /** Owned tiles outside the home ring. */
  readonly outer: number;
  /** Of those, fully explored. */
  readonly explored: number;
  readonly homesteads: number;
  /** Gatherers working a homestead, with the bonus on (they go where they bank the most). */
  readonly onHomesteads: number;
  /** Everything gathered in the day, as if homesteads gave nothing extra. */
  readonly without: Income;
  /** And with the homestead bonus. */
  readonly with: Income;
}

export function total(income: Income): number {
  return Object.values(income).reduce((a, b) => a + b, 0);
}

function sum(a: Income, b: Income): Income {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) add(out, k, v);
  return out;
}

export function economyDay(
  day: number,
  profile: EconomyProfile,
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  progress: ExploreProgress,
  bonus: Pick<ExploreRules, 'homestead'> = EXPLORE_RULES,
): EconomyDay {
  const homesteads = homesteadsOf(land, tiles, progress);
  const spots = gatherSpots(land, tiles, homesteads);
  const gather = (b: HomesteadBonus) =>
    sum(keeperPerDay(profile, spots, b), gatherersPerDay(profile, spots, b));
  const owned = new Set(land);
  return {
    day,
    outer: land.filter((k) => tiles.get(k)?.homeSlot === null).length,
    explored: [...progress].filter(([k, p]) => owned.has(k) && p.searched >= p.spots).length,
    homesteads: homesteads.size,
    onHomesteads: gatherersOnHomesteads(profile, spots, bonus),
    without: gather(null),
    with: gather(bonus),
  };
}
