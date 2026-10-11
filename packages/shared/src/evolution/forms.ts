import type { EvolutionOdds } from '../schemas/data/evolution-odds.js';
import type { SecretEvolution } from '../schemas/data/server-game-data.js';
import type { Species } from '../schemas/data/species.js';
import type { EvolutionForm } from './roll.js';

/**
 * Every evolution as a form with its branch trigger (#32): public
 * evolutions first (with their `evolutionOdds` row, if any), then secret
 * ones, so each step's default form comes first. `checkServerGameData`
 * makes sure every branch has odds and no default has any.
 */
export function evolutionForms(tables: {
  readonly species: readonly Pick<Species, 'id' | 'evolutions'>[];
  readonly secretEvolutions: readonly SecretEvolution[];
  readonly evolutionOdds: readonly EvolutionOdds[];
}): EvolutionForm[] {
  const odds = new Map(tables.evolutionOdds.map((o) => [`${o.from}>${o.into}`, o.trigger]));
  return [
    ...tables.species.flatMap((s) =>
      s.evolutions.map((e) => {
        const trigger = odds.get(`${s.id}>${e.into}`);
        return { from: s.id, into: e.into, level: e.level, ...(trigger && { trigger }) };
      }),
    ),
    ...tables.secretEvolutions.map((e) => ({
      from: e.from,
      into: e.into,
      level: e.level,
      ...(e.trigger && { trigger: e.trigger }),
    })),
  ];
}
