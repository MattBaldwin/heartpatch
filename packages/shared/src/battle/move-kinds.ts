import type { BattleMoveKindRules } from '../schemas/data/battle.js';
import type { Move, MoveKind } from '../schemas/data/moves.js';

/*
 * Steady and Big moves (#587): every damaging move is one or the other, per
 * species, so each attack is a real choice. A species' lowest-power damaging
 * move is steady (an exact tie goes to the surer one, then the first listed)
 * and the rest are big; a species with one damaging move has a big one, so it
 * can always finish a wild squishy. Moves with no power have no kind. Battle
 * rules `moveKinds.overrides` fix the few the rule reads wrong.
 */

/** What the sorting reads of a species: its id (for overrides) and its moves. */
export interface MoveKindSpecies {
  readonly id: string;
  readonly moves: readonly string[];
}

/** Each species' move kinds: species id → move id → kind. */
export type MoveKindTable = ReadonlyMap<string, ReadonlyMap<string, MoveKind>>;

/** One species' damaging moves sorted into kinds, overrides applied. */
export function speciesMoveKinds(
  species: MoveKindSpecies,
  moves: ReadonlyMap<string, Move>,
  rules: Pick<BattleMoveKindRules, 'overrides'>,
): Map<string, MoveKind> {
  const attacks = species.moves.flatMap((id) => {
    const move = moves.get(id);
    return move && move.power > 0 ? [move] : [];
  });
  const kinds = new Map<string, MoveKind>();
  let steady: Move | undefined;
  if (attacks.length > 1) {
    for (const move of attacks) {
      if (
        !steady ||
        move.power < steady.power ||
        (move.power === steady.power && move.accuracy > steady.accuracy)
      ) {
        steady = move;
      }
    }
  }
  for (const move of attacks) kinds.set(move.id, move === steady ? 'steady' : 'big');
  for (const [id, kind] of Object.entries(rules.overrides[species.id] ?? {})) {
    if (kinds.has(id)) kinds.set(id, kind);
  }
  return kinds;
}

/** Every species' move kinds. */
export function moveKindTable(
  species: readonly MoveKindSpecies[],
  moves: ReadonlyMap<string, Move>,
  rules: Pick<BattleMoveKindRules, 'overrides'>,
): MoveKindTable {
  return new Map(species.map((s) => [s.id, speciesMoveKinds(s, moves, rules)]));
}

/**
 * Readable problems with the kinds, or `[]`: a species with two or more
 * damaging moves needs one of each, one with a single damaging move needs it
 * big (or it could never finish a wild squishy), and every override must name
 * a species' own damaging move.
 */
export function moveKindProblems(
  species: readonly MoveKindSpecies[],
  moves: ReadonlyMap<string, Move>,
  rules: Pick<BattleMoveKindRules, 'overrides'>,
): string[] {
  const problems: string[] = [];
  const byId = new Map(species.map((s) => [s.id, s]));
  for (const s of species) {
    const kinds = [...speciesMoveKinds(s, moves, rules).values()];
    if (!kinds.includes('big')) problems.push(`${s.id}: needs a big move`);
    if (kinds.length > 1 && !kinds.includes('steady'))
      problems.push(`${s.id}: needs a steady move`);
  }
  for (const [speciesId, fixes] of Object.entries(rules.overrides)) {
    const s = byId.get(speciesId);
    if (!s) {
      problems.push(`overrides: unknown species "${speciesId}"`);
      continue;
    }
    for (const id of Object.keys(fixes)) {
      if (!s.moves.includes(id) || !((moves.get(id)?.power ?? 0) > 0)) {
        problems.push(`overrides: ${speciesId} has no damaging move "${id}"`);
      }
    }
  }
  return problems;
}
