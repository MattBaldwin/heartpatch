import type { Rng } from '../rng/index.js';
import type { BattleStats } from '../schemas/battle.js';
import type { BattleRules } from '../schemas/data/battle.js';
import type { BattleStat, Move } from '../schemas/data/moves.js';
import type { Rarity } from '../schemas/data/common.js';
import type { BaseStats } from '../schemas/data/species.js';
import { BattleRuleError, type BattleContent } from './content.js';
import type { BattleSquishy } from './state.js';

/*
 * Battle maths (design doc §6), bit-identical on every JS engine (V8 on the
 * server, JavaScriptCore in Safari). Only +, −, ×, ÷ and Math.floor/min/max/
 * abs are used: ECMAScript requires each of these to be a correctly rounded
 * IEEE 754 double operation, evaluated in source order, with no fused
 * multiply-add. Each step rounds explicitly by that rule, so the same inputs
 * give the same bits everywhere. Never use Math.pow, exp, log or trig here:
 * engines may approximate those differently. Energy, damage and heals are
 * floored to integers before they touch state.
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

/** A stat after stat stages and any potion boost (#214). */
export function effectiveStat(
  squishy: BattleSquishy,
  stat: BattleStat,
  rules: BattleRules,
): number {
  const staged = squishy.stats[stat] * stageMultiplier(squishy.stages[stat], rules);
  const boost = stat === 'speed' ? 0 : squishy.boosts[stat];
  return boost === 0 ? staged : (staged * (100 + boost)) / 100;
}

/**
 * A landed hit's energy after the target's shield (#214): `shield`% less,
 * rounded down, but never below the damage `minimum`.
 */
export function shieldedAmount(amount: number, shield: number, rules: BattleRules): number {
  if (shield === 0) return amount;
  return Math.min(
    amount,
    Math.max(rules.damage.minimum, Math.floor((amount * (100 - shield)) / 100)),
  );
}

/** Element × feeling for a move into a defender: what the callout describes. */
export function matchupMultiplier(
  content: BattleContent,
  move: Move,
  attacker: BattleSquishy,
  defender: BattleSquishy,
): number {
  // A fence (#203) has no feelings: only its material's element counts.
  const feeling =
    defender.fence === undefined ? content.feelingMatrix[attacker.feeling][defender.feeling] : 1;
  return content.elementMatrix[move.element][defender.element] * feeling;
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

/**
 * The chance (whole percent, 1–100) that a wild squishy accepts a Heart Charm
 * (design doc §6, battle rules `capture`): `atFull` at full energy rising in
 * a straight line to `nearlyOut` with 1 energy left, rounded down, then ×
 * the rarity's share, rounded down, at least 1.
 */
export function captureChance(
  target: { readonly energy: number; readonly stats: { readonly hp: number } },
  rarity: Rarity,
  rules: BattleRules,
): number {
  const { atFull, nearlyOut } = rules.capture;
  const full = target.stats.hp;
  const energy = Math.max(1, Math.min(full, target.energy));
  // Energy lost so far, out of the most it can lose and still be awake.
  const span = Math.max(1, full - 1);
  const base = atFull + Math.floor(((nearlyOut - atFull) * (full - energy)) / span);
  const chance = Math.floor((base * rules.capture.rarity[rarity]) / 100);
  return Math.max(1, Math.min(100, chance));
}
