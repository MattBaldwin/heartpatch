import { activeSeasons } from '../data/season-windows.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { PatchType } from '../patch-types/patch-type.js';
import type { Rarity } from '../schemas/data/common.js';
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
  /** A Rare Lure made it rarer than the plain roll (#729). Absent otherwise. */
  readonly lured?: true;
}

export interface SpawnInput {
  /** The tile's spawn seed for this window. Secret. */
  readonly seed: Seed;
  readonly terrain: string;
  readonly window: SpawnWindow;
  /**
   * The player's Partner's level, when they have one. With the rules'
   * `partnerOffset`, the wild squishy's level follows it.
   */
  readonly partnerLevel?: number | null;
  /**
   * The player holds a Rare Lure (#729): the squishy found is one rarity tier
   * up from the plain roll, from the same tables (`lureSpecies`).
   */
  readonly lure?: boolean;
}

export interface SpawnData {
  readonly tables: readonly SpawnTable[];
  /** Every species the server knows (public and secret). */
  readonly species: ReadonlyMap<string, Species>;
  readonly seasons: readonly Season[];
  readonly rules: SpawnRules;
  /** The top level a squishy can reach (`GROWTH_RULES.maxLevel`): Partner-scaled levels stop there. */
  readonly maxLevel: number;
}

/**
 * The tables that spawn on a patch of this type (#874): a table naming
 * `patchTypes` only on those types (a Clockwork Isle's tech squishies), one
 * naming none on every type. Leaving a table out never moves which tiles
 * have a squishy: that's `resolveWildSpawn`'s first draw, before any table.
 */
export function spawnTablesFor(tables: readonly SpawnTable[], patchType: PatchType): SpawnTable[] {
  return tables.filter((t) => t.patchTypes === undefined || t.patchTypes.includes(patchType));
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
  const level = wildLevel(
    rng,
    input.partnerLevel ?? null,
    data.species.get(species)?.rarity,
    data.rules,
    data.maxLevel,
  );
  const lured = input.lure ? lureSpecies(input.seed, species, entries, data) : null;
  return lured ? { speciesId: lured, level, lured: true } : { speciesId: species, level };
}

/** The rarity ladder a Rare Lure climbs (#729). `secret` is never on it. */
const LURE_LADDER: readonly Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
];

/**
 * A Rare Lure's squishy (#729 plan §1a), or null when nothing rarer lives
 * here: from the same matched entries as the plain roll (so season and time
 * of day still decide), the next tier up that has anyone, climbing past a
 * missing tier. Never a secret, and a secret plain roll is left alone. Picked
 * by weight on its own stream, so the plain roll's level and every other
 * tile's roll are untouched, and a retried start finds the same squishy.
 */
function lureSpecies(
  seed: Seed,
  plain: string,
  entries: readonly { species: string; weight: number }[],
  data: SpawnData,
): string | null {
  const rarityOf = (id: string) => data.species.get(id)?.rarity;
  const from = LURE_LADDER.indexOf(rarityOf(plain) ?? 'secret');
  if (from < 0) return null;
  for (const tier of LURE_LADDER.slice(from + 1)) {
    const pool = entries.filter((e) => rarityOf(e.species) === tier);
    if (pool.length > 0) return Rng.fromSeed(deriveSeed(seed, 'lure')).weighted(pool).species;
  }
  return null;
}

/**
 * The level roll: the Partner's level plus `partnerOffset`, less the
 * species' `rarityLevelDiscount`, when both exist; else `levels`. Always one
 * roll, so which species a tile has never depends on who's looking.
 */
function wildLevel(
  rng: Rng,
  partnerLevel: number | null,
  rarity: Rarity | undefined,
  rules: SpawnRules,
  maxLevel: number,
): number {
  const offset = rules.partnerOffset;
  if (!offset || partnerLevel === null) return rng.int(rules.levels.min, rules.levels.max);
  const discount = rarity === undefined ? 0 : (rules.rarityLevelDiscount?.[rarity] ?? 0);
  const level = partnerLevel + rng.int(offset.min, offset.max) - discount;
  return Math.max(rules.levels.min, Math.min(maxLevel, level));
}
