import { BUILDINGS } from '../../src/data/buildings.js';
import { HOLLOW_RULES } from '../../src/data/hollow.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { RESOURCES } from '../../src/data/resources.js';
import { workSource } from '../../src/jobs/index.js';
import { hexKey, hexSpiral, type HexKey } from '../../src/hex/index.js';
import type { MapTile } from '../../src/mapgen/index.js';
import type { FuelProfile } from './fuel-config.js';
import { gatherersPerDay } from './fuel.js';

/*
 * Can a kid light ALL their land? (#277, the coordinator's guardrail c.)
 * Every bit of land outside home needs a lit Hearthfire's light, or the
 * Hollow Man can win it back. This lays fires on the kid's real land from
 * `pnpm sim:progression` (greedy: each fire where it lights the most dark
 * land; a fire can't stand on a tile with a node in its middle), first all
 * at level 1, then, if those burn more Emberwood than the kid brings in, as
 * level 3 fires (radius 2) taken back down to level 1 wherever that still
 * lights everything. Then it checks the fuel (fires ≤ Emberwood a day) and
 * the build cost (every fire's levels, paid from the Timber, Stone and
 * Glimmer the kid has banked by that day, a share of it kept for other builds).
 */

/** What the cover model leaves out, for the report. */
export const COVER_LIMITS = [
  "fires are laid fresh each day on that day's land (no fire is ever moved)",
  'the kid places fires as well as a greedy planner (a real kid, a little worse)',
  "build materials come from the Keeper tapping the profile's nodes each session and its build gatherers",
  'a fixed share of build materials goes to fires; the rest is for other builds',
] as const;

const hearthfire = BUILDINGS.find((b) => b.id === 'hearthfire');
if (hearthfire?.kind !== 'hearthfire') throw new Error('no Hearthfire in the building data');
const LEVELS = hearthfire.levels;
const LOW = LEVELS.findIndex((l) => l.safeRadius === LEVELS[0]?.safeRadius);
/** The cheapest level with the widest light. */
const HIGH = LEVELS.reduce(
  (best, l, i) => (l.safeRadius > (LEVELS[best]?.safeRadius ?? 0) ? i : best),
  0,
);

/** Everything paid for a fire built and raised to `level` (0-based). */
function costTo(level: number): Record<string, number> {
  const total: Record<string, number> = {};
  for (const l of LEVELS.slice(0, level + 1)) {
    for (const [item, n] of Object.entries(l.cost)) total[item] = (total[item] ?? 0) + n;
  }
  return total;
}

/** A plan: where the fires go and at which level (0-based). */
export interface FirePlan {
  readonly fires: readonly { readonly at: HexKey; readonly level: number }[];
  /** Outer tiles no fire site of theirs reaches at the widest light. */
  readonly outOfReach: number;
}

/** Greedy fires lighting every tile of `need` they can reach, at one radius. */
function greedy(
  need: ReadonlySet<HexKey>,
  sites: readonly MapTile[],
  radius: number,
): { fires: HexKey[]; left: Set<HexKey> } {
  const left = new Set(need);
  const fires: HexKey[] = [];
  const reach = new Map(sites.map((s) => [hexKey(s), hexSpiral(s, radius).map(hexKey)]));
  for (;;) {
    let best: HexKey | null = null;
    let gain = 0;
    for (const [at, lit] of reach) {
      const n = lit.filter((k) => left.has(k)).length;
      if (n > gain || (n === gain && n > 0 && best !== null && at < best)) {
        best = at;
        gain = n;
      }
    }
    if (best === null || gain === 0) return { fires, left };
    fires.push(best);
    for (const k of reach.get(best) ?? []) left.delete(k);
    reach.delete(best);
  }
}

/** Fires that light all the kid's outer land, as cheaply as the fuel allows. */
export function planFires(
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  fuelFires: number,
): FirePlan {
  const owned = land.flatMap((k) => {
    const t = tiles.get(k);
    return t ? [t] : [];
  });
  const outer = new Set(owned.filter((t) => t.homeSlot === null).map(hexKey));
  const sites = owned.filter(
    (t) => t.homeSlot === null && !(HOLLOW_RULES.strength.nodesBlockFires && t.nodeResource),
  );
  const low = LEVELS[LOW]?.safeRadius ?? 1;
  const high = LEVELS[HIGH]?.safeRadius ?? low;
  const wide = greedy(outer, sites, high);
  const outOfReach = wide.left.size;
  const plain = greedy(outer, sites, low);
  if (plain.fires.length <= fuelFires || high === low) {
    return { fires: plain.fires.map((at) => ({ at, level: LOW })), outOfReach };
  }
  // Wide fires, then each taken back down where the land stays lit.
  const levels = new Map(wide.fires.map((at) => [at, HIGH]));
  const litBy = (plan: ReadonlyMap<HexKey, number>) => {
    const lit = new Set<HexKey>();
    for (const [at, level] of plan) {
      const tile = tiles.get(at);
      if (!tile) continue;
      for (const h of hexSpiral(tile, LEVELS[level]?.safeRadius ?? low)) lit.add(hexKey(h));
    }
    return lit;
  };
  const goal = [...outer].filter((k) => !wide.left.has(k));
  for (const at of wide.fires) {
    levels.set(at, LOW);
    const lit = litBy(levels);
    if (!goal.every((k) => lit.has(k))) levels.set(at, HIGH);
  }
  return { fires: [...levels].map(([at, level]) => ({ at, level })), outOfReach };
}

/** What a plan costs to build. */
export function planCost(plan: FirePlan): Record<string, number> {
  const total: Record<string, number> = {};
  for (const fire of plan.fires) {
    for (const [item, n] of Object.entries(costTo(fire.level))) {
      total[item] = (total[item] ?? 0) + n;
    }
  }
  return total;
}

/**
 * Build materials banked by the end of `day` for fires: the Keeper taps the
 * profile's build nodes each session (where the kid owns one) and its build
 * gatherers work the best spots it owns, every day so far; `buildShare`
 * percent of it goes to fires.
 */
export function buildBudget(
  profile: FuelProfile,
  day: number,
  owned: readonly MapTile[],
): Record<string, number> {
  const budget: Record<string, number> = {};
  const gaps = profile.sessions.map((hour, i) => {
    const next = profile.sessions[i + 1] ?? (profile.sessions[0] ?? 0) + 24;
    return (next - hour) * 3600;
  });
  const resources = new Set([
    ...Object.keys(profile.buildNodes),
    ...Object.keys(profile.buildGatherers),
  ]);
  for (const resource of resources) {
    const gather = RESOURCES.find((r) => r.id === resource)?.gather;
    if (!gather) throw new Error(`"${resource}" can't be gathered`);
    const nodes = owned.filter((t) => t.nodeResource === resource).length;
    const finished = gaps.filter((gap) => gap >= gather.seconds).length;
    const keeper = finished * Math.min(profile.buildNodes[resource] ?? 0, nodes) * gather.quantity;
    const spots = owned
      .map((tile) => workSource(tile, RESOURCES, JOB_RULES))
      .filter((s) => s?.resource === resource)
      .map((s) => ({ quantity: s?.quantity ?? 0, seconds: s?.seconds ?? 1 }))
      .sort((a, b) => b.quantity / b.seconds - a.quantity / a.seconds);
    const gatherers = gatherersPerDay(
      { ...profile, gatherers: profile.buildGatherers[resource] ?? 0 },
      { nodes, spots, outer: 0 },
    );
    budget[resource] = Math.floor(((keeper + gatherers) * day * profile.buildShare) / 100);
  }
  return budget;
}

/** One day's verdict: can the kid light all their land? */
export interface CoverDay {
  readonly fires: number;
  /** Fires at the widest level. */
  readonly wideFires: number;
  readonly cost: Record<string, number>;
  readonly budget: Record<string, number>;
  readonly outOfReach: number;
  readonly fuelOk: boolean;
  readonly costOk: boolean;
}

export function coverDay(
  profile: FuelProfile,
  day: number,
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  fuelFires: number,
): CoverDay {
  const plan = planFires(land, tiles, fuelFires);
  const cost = planCost(plan);
  const owned = land.flatMap((k) => {
    const t = tiles.get(k);
    return t ? [t] : [];
  });
  const budget = buildBudget(profile, day, owned);
  return {
    fires: plan.fires.length,
    wideFires: plan.fires.filter((f) => f.level === HIGH && HIGH !== LOW).length,
    cost,
    budget,
    outOfReach: plan.outOfReach,
    fuelOk: plan.fires.length <= fuelFires,
    costOk: Object.entries(cost).every(([item, n]) => (budget[item] ?? 0) >= n),
  };
}
