import { BATTLE_RULES } from '../data/battle.js';
import type { BattleRules } from '../schemas/data/battle.js';
import type { GameData } from '../schemas/data/game-data.js';
import type { ElementMatrix, FeelingMatrix, SynergyTable } from '../schemas/data/matrices.js';
import type { Move } from '../schemas/data/moves.js';
import type { Species } from '../schemas/data/species.js';

/** The data tables a battle reads, indexed by id. */
export interface BattleContent {
  readonly species: ReadonlyMap<string, Species>;
  readonly moves: ReadonlyMap<string, Move>;
  readonly elementMatrix: ElementMatrix;
  readonly feelingMatrix: FeelingMatrix;
  readonly synergy: SynergyTable;
  readonly rules: BattleRules;
}

export type BattleData = Pick<
  GameData,
  'species' | 'moves' | 'elementMatrix' | 'feelingMatrix' | 'synergy'
>;

/**
 * Indexes validated game data for the engine. Build it once and reuse it:
 * the engine never changes it.
 */
export function createBattleContent(
  data: BattleData,
  rules: BattleRules = BATTLE_RULES,
): BattleContent {
  return {
    species: new Map(data.species.map((s) => [s.id, s])),
    moves: new Map(data.moves.map((m) => [m.id, m])),
    elementMatrix: data.elementMatrix,
    feelingMatrix: data.feelingMatrix,
    synergy: data.synergy,
    rules,
  };
}

/** A setup, action or state that breaks the battle rules. */
export class BattleRuleError extends Error {
  override readonly name = 'BattleRuleError';
}

export function getMove(content: BattleContent, id: string): Move {
  const move = content.moves.get(id);
  if (!move) throw new BattleRuleError(`unknown move "${id}"`);
  return move;
}

export function getSpecies(content: BattleContent, id: string): Species {
  const species = content.species.get(id);
  if (!species) throw new BattleRuleError(`unknown species "${id}"`);
  return species;
}
