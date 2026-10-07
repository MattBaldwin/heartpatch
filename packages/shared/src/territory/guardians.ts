import { activeSeasons } from '../data/season-windows.js';
import { Rng, type Seed } from '../rng/index.js';
import type { BattleSquishySetup } from '../schemas/battle.js';
import type { GuardianRules, GuardianStrengthTier } from '../schemas/data/guardian-rules.js';
import type { Season } from '../schemas/data/seasons.js';
import type { Species } from '../schemas/data/species.js';
import type { GuardianDifficulty, GuardianHint } from '../schemas/maps.js';
import type { SpawnWindow } from '../spawns/window.js';

/*
 * Tile guardians (design doc §11; tech spec §8 "No rerolls"). Pure: the
 * server passes the tile's guardian seed (`deriveSeed(mapSeed, 'guardian', q,
 * r, windowId)`, never revealed) and the secret guardian rules, so the same
 * tile in the same window always has the same guardians, and starting over
 * can't reroll them.
 */

export interface GuardianInput {
  /** The tile's guardian seed for this window. Secret. */
  readonly seed: Seed;
  readonly terrain: string;
  /** `tiles.guardian_strength`; null (a home tile, or a hand-authored map) counts as 1. */
  readonly strength: number | null;
  readonly window: SpawnWindow;
}

export interface GuardianData {
  readonly rules: GuardianRules;
  /** Every species the server knows (public and secret). */
  readonly species: ReadonlyMap<string, Species>;
  readonly seasons: readonly Season[];
}

/** The tier for a strength: the strongest tier at or below it (the weakest if none). */
export function guardianTier(rules: GuardianRules, strength: number | null): GuardianStrengthTier {
  const wanted = strength ?? 1;
  let tier = rules.strengths[0];
  if (!tier) throw new RangeError('guardianTier(): no strength tiers');
  for (const candidate of rules.strengths) if (candidate.strength <= wanted) tier = candidate;
  return tier;
}

/**
 * The tile's guardian team for this window (ids `guardian-1`, …), or an empty
 * list if no table guards its terrain. Tables match on terrain and on their
 * season when they name one; a seasonal species only guards in its season.
 */
export function resolveGuardians(input: GuardianInput, data: GuardianData): BattleSquishySetup[] {
  const rng = Rng.fromSeed(input.seed);
  const tier = guardianTier(data.rules, input.strength);
  const seasons = new Set(activeSeasons(data.seasons, input.window.date).map((s) => s.id));
  const entries = data.rules.tables
    .filter(
      (table) =>
        table.terrains.includes(input.terrain) &&
        (table.season === undefined || seasons.has(table.season)),
    )
    .flatMap((table) => table.entries)
    .filter((entry) => {
      const species = data.species.get(entry.species);
      return species !== undefined && (species.season === undefined || seasons.has(species.season));
    });
  if (entries.length === 0) return [];

  return Array.from({ length: tier.count }, (_, i) => ({
    id: `guardian-${String(i + 1)}`,
    speciesId: rng.weighted(entries).species,
    level: rng.int(tier.levels.min, tier.levels.max),
  }));
}

/**
 * What the tile panel may say about a team (owner decision 10): how many, and
 * a difficulty word from the team's total level against the fixed `hint`
 * bands, so every member sees the same hint. Null for no team. Never species,
 * levels, moves or seeds (CLAUDE.md rule 6).
 */
export function hintForGuardians(
  team: readonly (Pick<BattleSquishySetup, 'level' | 'feeling'> & { speciesId?: string })[],
  rules: Pick<GuardianRules, 'hint'>,
  /** For feelings: a guardian without its own feels as its species does, as in battle. */
  species?: ReadonlyMap<string, Pick<Species, 'feeling'>>,
): GuardianHint | null {
  if (team.length === 0) return null;
  const total = team.reduce((sum, g) => sum + g.level, 0);
  const difficulty: GuardianDifficulty =
    total <= rules.hint.easyUpTo ? 'easy' : total <= rules.hint.toughUpTo ? 'tough' : 'very-tough';
  // Only their feelings, in team order (#216): never species, levels or elements.
  // All or nothing, so the line never names some guardians and not others.
  const feelings = team.flatMap((g) => {
    const feeling =
      g.feeling ?? (g.speciesId === undefined ? undefined : species?.get(g.speciesId)?.feeling);
    return feeling === undefined ? [] : [feeling];
  });
  return {
    count: team.length,
    difficulty,
    feelings: feelings.length === team.length ? feelings : [],
  };
}
