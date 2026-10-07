import { BUILDINGS } from '../../src/data/buildings.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { RESOURCES } from '../../src/data/resources.js';
import type { HexKey } from '../../src/hex/index.js';
import { workCycleSeconds, workProgress, workSource } from '../../src/jobs/index.js';
import type { MapTile } from '../../src/mapgen/index.js';
import type { FuelProfile } from './fuel-config.js';

/*
 * How many Hearthfires a kid can keep lit (#202). Each fire burns
 * `fuelPerNight` Emberwood at nightfall, so the steady state is one fire per
 * Emberwood a day. Land comes from `pnpm sim:progression` (the tiles a kid
 * owns on a day); fuel comes from the real gather and gatherer rules:
 *
 * - the Keeper starts one gather on each Emberwood node they tap, every
 *   session; it lands in the bag at the next session if it has finished;
 * - each Emberwood gatherer works the best spot the kid owns (a node, then
 *   old-forest land) and banks its cycles at every session, capped at
 *   `maxStoredCycles` (`workProgress`, the server's own maths).
 *
 * Fires the land allows: one per outer tile (`maxPerTile`). None at home:
 * the Heart Seed keeps it safe (owner decision 2026-10-07).
 * The Jack-o'-Lantern Hearthfire is a Halloween extra and isn't counted.
 */

/** What the model leaves out, for the report. */
export const FUEL_LIMITS = [
  'the kid plays every day at the same hours',
  'Emberwood goes only to fuel (the Jack-o-Lantern recipe takes 2, once)',
  'gatherers start on the day: no carry-over from the day before',
  'a fire is worth building on every outer tile (in play, fewer: radius 1 covers 7 tiles)',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const hearthfire = BUILDINGS.find((b) => b.id === 'hearthfire');
if (hearthfire?.kind !== 'hearthfire') throw new Error('no Hearthfire in the building data');
export const FUEL_PER_NIGHT = hearthfire.fuelPerNight;
const emberwood = RESOURCES.find((r) => r.id === hearthfire.fuelResource);
if (!emberwood?.gather) throw new Error('the Hearthfire burns something that cannot be gathered');
const keeperGather = emberwood.gather;

/** Where Emberwood comes from on a kid's land. */
export interface EmberwoodLand {
  /** Owned tiles with an Emberwood node (home's first). */
  readonly nodes: number;
  /** Gatherer spots, best first: Emberwood per hour of work at 100 % speed. */
  readonly spots: readonly { quantity: number; seconds: number }[];
  /** Owned tiles outside the home ring. */
  readonly outer: number;
}

export function emberwoodLand(
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
): EmberwoodLand {
  const owned = land.map((key) => {
    const tile = tiles.get(key);
    if (!tile) throw new Error(`no tile ${key}`);
    return tile;
  });
  const spots = owned
    .map((tile) => workSource(tile, RESOURCES, JOB_RULES))
    .filter((s) => s?.resource === emberwood?.id)
    .map((s) => ({ quantity: s?.quantity ?? 0, seconds: s?.seconds ?? 1 }))
    .sort((a, b) => b.quantity / b.seconds - a.quantity / a.seconds);
  return {
    nodes: owned.filter((t) => t.nodeResource === emberwood?.id).length,
    spots,
    outer: owned.filter((t) => t.homeSlot === null).length,
  };
}

/** Gaps between one session and the next, wrapping round to tomorrow's first. */
function sessionGapsMs(sessions: readonly number[]): number[] {
  return sessions.map((hour, i) => {
    const next = sessions[i + 1] ?? (sessions[0] ?? 0) + 24;
    return (next - hour) * HOUR_MS;
  });
}

/** Emberwood the Keeper brings in a day: one gather per tapped node per session. */
export function keeperPerDay(profile: FuelProfile, land: EmberwoodLand): number {
  const finished = sessionGapsMs(profile.sessions).filter(
    (gap) => gap >= keeperGather.seconds * 1000,
  ).length;
  return finished * Math.min(profile.keeperNodes, land.nodes) * keeperGather.quantity;
}

/** Emberwood the kid's gatherers bank in a day (settled at every session). */
export function gatherersPerDay(profile: FuelProfile, land: EmberwoodLand): number {
  let total = 0;
  for (const spot of land.spots.slice(0, profile.gatherers)) {
    const cycle = workCycleSeconds(spot.seconds, profile.gathererSpeedPercent, JOB_RULES);
    let since = 0;
    let at = 0;
    for (const gap of sessionGapsMs(profile.sessions)) {
      at += gap;
      const done = workProgress(since, at, cycle, JOB_RULES);
      total += done.cycles * spot.quantity;
      since = done.nextSinceMs;
    }
    if (at !== DAY_MS) throw new Error('sessions must fit in one day');
  }
  return total;
}

/** One kid on one day. */
export interface FuelDay {
  readonly day: number;
  readonly outer: number;
  readonly nodes: number;
  readonly keeper: number;
  readonly gatherers: number;
  /** Fires the kid's land allows: one per outer tile. */
  readonly landFires: number;
  /** Fires the Keeper's gathers alone keep lit. */
  readonly keeperFires: number;
  /** Fires all their Emberwood keeps lit. */
  readonly fuelFires: number;
  /** What they can keep lit: the smaller of land and fuel. */
  readonly lit: number;
}

export function fuelDay(day: number, profile: FuelProfile, land: EmberwoodLand): FuelDay {
  const keeper = keeperPerDay(profile, land);
  const gatherers = gatherersPerDay(profile, land);
  const landFires = land.outer;
  const fuelFires = Math.floor((keeper + gatherers) / FUEL_PER_NIGHT);
  return {
    day,
    outer: land.outer,
    nodes: land.nodes,
    keeper,
    gatherers,
    landFires,
    keeperFires: Math.floor(keeper / FUEL_PER_NIGHT),
    fuelFires,
    lit: Math.min(landFires, fuelFires),
  };
}
