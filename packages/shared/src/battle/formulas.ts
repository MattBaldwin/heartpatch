import type { Rng } from '../rng/index.js';
import type { BattleStats } from '../schemas/battle.js';
import type { BattleRules } from '../schemas/data/battle.js';
import type { BattleStat, Move } from '../schemas/data/moves.js';
import type { BaseStats } from '../schemas/data/species.js';
import { BattleRuleError, type BattleContent } from './content.js';
import type { BattleSquishy } from './state.js';

/*
 * Battle maths (design doc §6). Only +, −, ×, ÷ and Math.floor/min/max, which
 * IEEE 754 makes identical on every JS engine, so a replay on the client, the
 * server or the simulator gives the same numbers. No Math.pow, exp or trig.
 */

/** Stats at `level` from base stats (battle rules `stats`). */
export function statsAtLevel(base: BaseStats, level: number, rules: BattleRules): BattleStats {
  const { levelDivisor, flat, hpPerLevel, hpFlat } = rules.stats;
  const scale = (value: number) => Math.floor((value * level) / levelDivisor);
  return {
    hp: scale(base.hp) + level * hpPerLevel + hpFlat,
    attack: scale(base.attack) + flat,
    defense: scale(base.defense) + flat,
    speed: scale(base.speed) + flat,
  };
}

/** `1 + perStage × n` for n stages up; its reciprocal for n stages down. */
export function stageMultiplier(stages: number, rules: BattleRules): number {
  const factor = 1 + rules.statStages.perStage * Math.abs(stages);
  return stages >= 0 ? factor : 1 / factor;
}

/** A stat after stat stages. */
export function effectiveStat(
  squishy: BattleSquishy,
  stat: BattleStat,
  rules: BattleRules,
): number {
  return squishy.stats[stat] * stageMultiplier(squishy.stages[stat], rules);
}

/** Element × feeling for a move into a defender: what the callout describes. */
export function matchupMultiplier(
  content: BattleContent,
  move: Move,
  attacker: BattleSquishy,
  defender: BattleSquishy,
): number {
  return (
    content.elementMatrix[move.element][defender.element] *
    content.feelingMatrix[attacker.feeling][defender.feeling]
  );
}

/** The callout tier id for a matchup multiplier (battle rules `effectiveness`). */
export function effectivenessTier(multiplier: number, rules: BattleRules): string {
  for (const tier of rules.effectiveness) if (multiplier >= tier.atLeast) return tier.id;
  throw new BattleRuleError('battle rules need an effectiveness tier that starts at 0');
}

/**
 * Damage before the variance roll: `base(power, attack, defense, level)` ×
 * element × feeling × the attacker's synergy.
 */
export function damageBeforeVariance(
  content: BattleContent,
  move: Move,
  attacker: BattleSquishy,
  defender: BattleSquishy,
): number {
  const { rules } = content;
  const d = rules.damage;
  const attack = effectiveStat(attacker, 'attack', rules);
  const defense = effectiveStat(defender, 'defense', rules);
  const base =
    ((attacker.level / d.levelDivisor + d.levelOffset) * move.power * attack) /
      defense /
      d.powerDivisor +
    d.flat;
  return (
    base *
    matchupMultiplier(content, move, attacker, defender) *
    content.synergy[attacker.element][attacker.feeling]
  );
}

/** The energy a landed move takes, with the seeded variance roll. */
export function rollDamage(
  content: BattleContent,
  move: Move,
  attacker: BattleSquishy,
  defender: BattleSquishy,
  rng: Rng,
): number {
  const { varianceMin, varianceMax, minimum } = content.rules.damage;
  const variance = varianceMin + rng.next() * (varianceMax - varianceMin);
  const amount = Math.floor(damageBeforeVariance(content, move, attacker, defender) * variance);
  return Math.max(minimum, amount);
}

/** Expected damage (average variance), for AI planning. Never rolls. */
export function expectedDamage(
  content: BattleContent,
  move: Move,
  attacker: BattleSquishy,
  defender: BattleSquishy,
): number {
  const { varianceMin, varianceMax, minimum } = content.rules.damage;
  const amount = damageBeforeVariance(content, move, attacker, defender);
  return Math.max(minimum, (amount * (varianceMin + varianceMax)) / 2);
}
