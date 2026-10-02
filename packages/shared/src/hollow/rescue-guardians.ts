import { Rng, type Seed } from '../rng/index.js';
import type { BattleSquishySetup } from '../schemas/battle.js';
import type { RescueGuardianRules } from '../schemas/data/hollow.js';
import type { Species } from '../schemas/data/species.js';

/**
 * A rescue expedition's shadow guardians (design doc §14; ids `shadow-1`, …).
 * Pure and seeded like tile guardians (tech spec §8 "No rerolls"): the server
 * passes a secret seed fixed per squishy and day, so trying again meets the
 * same shadows. Their level follows the player's strongest active squishy.
 * Species the server doesn't know are skipped; none left gives no guardians.
 */
export function resolveRescueGuardians(
  input: { readonly seed: Seed; readonly strongestLevel: number },
  rules: RescueGuardianRules,
  species: ReadonlyMap<string, Species>,
): BattleSquishySetup[] {
  const entries = rules.entries.filter((e) => species.has(e.species));
  if (entries.length === 0) return [];
  const rng = Rng.fromSeed(input.seed);
  const level = Math.min(
    rules.levels.max,
    Math.max(rules.levels.min, input.strongestLevel + rules.levelOffset),
  );
  return Array.from({ length: rules.count }, (_, i) => ({
    id: `shadow-${String(i + 1)}`,
    speciesId: rng.weighted(entries).species,
    level,
  }));
}
