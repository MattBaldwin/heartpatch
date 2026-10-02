import { activeSeasons } from '../data/season-windows.js';
import { Rng, type Seed } from '../rng/index.js';
import type { Season } from '../schemas/data/seasons.js';
import type { SpawnRules, TimeOfDay } from '../schemas/data/spawn-rules.js';
import type { SpawnTable } from '../schemas/data/spawn-tables.js';
import type { Species } from '../schemas/data/species.js';
import { spawnWindowMidpoint, type SpawnWindow } from './window.js';

/*
 * Wild spawns (design doc §4, §15; tech spec §8). Pure: the server passes the
 * tile's spawn seed (`deriveSeed(mapSeed, 'spawn', q, r, windowId)`, never
 * revealed) and the secret tables, so the same tile in the same window always
 * has the same squishy, and restarting a battle can't reroll it.
 */

/** A wild squishy on a tile for one spawn window. */
export interface WildSpawn {
  readonly speciesId: string;
  readonly level: number;
}

export interface SpawnInput {
  /** The tile's spawn seed for this window. Secret. */
  readonly seed: Seed;
  readonly terrain: string;
  readonly window: SpawnWindow;
}

export interface SpawnData {
  readonly tables: readonly SpawnTable[];
  /** Every species the server knows (public and secret). */
  readonly species: ReadonlyMap<string, Species>;
  readonly seasons: readonly Season[];
  readonly rules: SpawnRules;
}

/** The window's time of day, judged at its middle (spawn rules `timesOfDay`). */
export function timeOfDayOf(window: SpawnWindow, rules: SpawnRules): TimeOfDay {
  const middle = spawnWindowMidpoint(window);
  let current = rules.timesOfDay[0]?.timeOfDay ?? 'day';
  for (const range of rules.timesOfDay) if (middle >= range.from) current = range.timeOfDay;
  return current;
}

/**
 * The tile's wild squishy for this window, or null if nobody's there. The
 * first roll decides whether anyone is there at all, so editing the tables
 * never moves which tiles have a squishy. Tables match on terrain, and on
 * their season and time of day when they name one; a seasonal species (e.g.
 * Halloween's) only spawns while its own season is on too, whatever table
 * lists it. Seasons follow the window's map-local date.
 */
export function resolveWildSpawn(input: SpawnInput, data: SpawnData): WildSpawn | null {
  const rng = Rng.fromSeed(input.seed);
  if (!rng.chance(data.rules.chance)) return null;

  const seasons = new Set(activeSeasons(data.seasons, input.window.date).map((s) => s.id));
  const timeOfDay = timeOfDayOf(input.window, data.rules);
  const entries = data.tables
    .filter(
      (table) =>
        table.terrains.includes(input.terrain) &&
        (table.season === undefined || seasons.has(table.season)) &&
        (table.timeOfDay === undefined || table.timeOfDay === timeOfDay),
    )
    .flatMap((table) => table.entries)
    .filter((entry) => {
      const species = data.species.get(entry.species);
      return species !== undefined && (species.season === undefined || seasons.has(species.season));
    });
  if (entries.length === 0) return null;

  const { species } = rng.weighted(entries);
  const level = rng.int(data.rules.levels.min, data.rules.levels.max);
  return { speciesId: species, level };
}
