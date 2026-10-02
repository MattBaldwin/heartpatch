import { BATTLE_RULES } from '../data/battle.js';
import { hashString } from '../rng/index.js';
import type { BattleRules } from '../schemas/data/battle.js';
import type { GameData } from '../schemas/data/game-data.js';
import type { ElementMatrix, FeelingMatrix, SynergyTable } from '../schemas/data/matrices.js';
import type { Move } from '../schemas/data/moves.js';
import type { Species } from '../schemas/data/species.js';

/** The data tables a battle reads, indexed by id. */
export interface BattleContent {
  /**
   * Fingerprint of every number and id that can change a battle's outcome
   * (not names or descriptions). Stored on each battle, so a replay after
   * re-tuning is caught instead of quietly playing out differently.
   */
  readonly contentHash: string;
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
    contentHash: battleContentHash(data, rules),
    species: new Map(data.species.map((s) => [s.id, s])),
    moves: new Map(data.moves.map((m) => [m.id, m])),
    elementMatrix: data.elementMatrix,
    feelingMatrix: data.feelingMatrix,
    synergy: data.synergy,
    rules,
  };
}

/** JSON with object keys sorted, so the same data always gives the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Hashes only the battle-relevant fields, so rewording a move changes nothing. */
export function battleContentHash(data: BattleData, rules: BattleRules): string {
  return hashString(
    canonicalJson({
      species: byId(data.species).map(({ id, element, feeling, baseStats, moves }) => ({
        id,
        element,
        feeling,
        baseStats,
        moves,
      })),
      moves: byId(data.moves).map(({ id, element, power, accuracy, effects }) => ({
        id,
        element,
        power,
        accuracy,
        effects,
      })),
      elementMatrix: data.elementMatrix,
      feelingMatrix: data.feelingMatrix,
      synergy: data.synergy,
      // Callout lines are player-facing words, not rules.
      rules: {
        ...rules,
        effectiveness: rules.effectiveness.map(({ id, atLeast }) => ({ id, atLeast })),
      },
    }),
  );
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
