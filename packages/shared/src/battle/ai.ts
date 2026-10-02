import type { Rng } from '../rng/index.js';
import type { BattleChoice, BattleSideId } from '../schemas/battle.js';
import type { BattleAiPolicy, BattleAiPolicyRules } from '../schemas/data/battle.js';
import type { Move } from '../schemas/data/moves.js';
import { getMove, type BattleContent } from './content.js';
import { expectedDamage } from './formulas.js';
import {
  activeSquishy,
  benchOf,
  otherSide,
  type BattleSquishy,
  type BattleState,
} from './state.js';

/*
 * Simple AI policies (design doc §6): wild squishies, tile guardians and the
 * offline defense stances. Each option gets a score from the policy's weights
 * (battle rules `ai`), and the AI picks with the battle's seeded RNG, so
 * AI-vs-AI battles replay exactly.
 */

/**
 * Keeps every move pickable, however weak it looks. Not a tunable: it only
 * avoids an all-zero weight table.
 */
const MIN_SCORE = 0.001;

interface Option<T> {
  readonly value: T;
  readonly weight: number;
}

/** `score ^ focus` by repeated multiplication (Math.pow isn't bit-identical everywhere). */
function sharpen(score: number, focus: number): number {
  let weight = 1;
  for (let i = 0; i < focus; i++) weight *= score;
  return weight;
}

/** True if `squishy` is below `percent`% of its full energy. */
const below = (squishy: BattleSquishy, percent: number) =>
  squishy.energy * 100 < percent * squishy.stats.hp;

/** How much of the target's remaining energy a move should take, 0–1. */
function damageShare(
  content: BattleContent,
  move: Move,
  user: BattleSquishy,
  target: BattleSquishy,
): number {
  if (move.power === 0) return 0;
  const share = expectedDamage(content, move, user, target) / Math.max(1, target.energy);
  return Math.min(1, share);
}

/** How good `move` looks to this policy right now. */
export function scoreMove(
  content: BattleContent,
  policy: BattleAiPolicyRules,
  move: Move,
  user: BattleSquishy,
  target: BattleSquishy,
): number {
  const { maxStages } = content.rules.statStages;
  const lands = move.accuracy / 100;
  let score = policy.damage * damageShare(content, move, user, target);
  for (const effect of move.effects ?? []) {
    switch (effect.type) {
      case 'heal': {
        if (!below(user, policy.healBelow)) break;
        const restored = Math.floor((user.stats.hp * effect.percent) / 100);
        score += (policy.heal * Math.min(restored, user.stats.hp - user.energy)) / user.stats.hp;
        break;
      }
      case 'stat': {
        const who = effect.target === 'self' ? user : target;
        const helps = (effect.target === 'self') === effect.stages > 0;
        if (!helps) break;
        const current = who.stages[effect.stat];
        const room = effect.stages > 0 ? maxStages - current : maxStages + current;
        const stages = Math.min(Math.abs(effect.stages), room);
        score += (policy.boost * stages * effect.chance) / 100;
        break;
      }
      case 'status':
        if (target.status === null) score += (policy.status * effect.chance) / 100;
        break;
    }
  }
  return score * lands;
}

/** The best damage share any of `user`'s moves has against `target`. */
function bestDamageShare(content: BattleContent, user: BattleSquishy, target: BattleSquishy) {
  let best = 0;
  for (const id of user.moves) {
    best = Math.max(best, damageShare(content, getMove(content, id), user, target));
  }
  return best;
}

/** Picks this turn's choice for an AI-controlled side. Advances `rng`. */
export function chooseAiChoice(
  content: BattleContent,
  state: BattleState,
  side: BattleSideId,
  policyId: BattleAiPolicy,
  rng: Rng,
): BattleChoice {
  const policy = content.rules.ai[policyId];
  const user = activeSquishy(state, side);
  const target = activeSquishy(state, otherSide(side));

  const options: Option<BattleChoice>[] = user.moves.map((id) => ({
    value: { type: 'move', move: id },
    weight: sharpen(
      Math.max(MIN_SCORE, scoreMove(content, policy, getMove(content, id), user, target)),
      policy.focus,
    ),
  }));

  if (policy.swap > 0 && below(user, policy.swapBelow)) {
    const now = bestDamageShare(content, user, target);
    for (const { slot, squishy } of benchOf(state, side)) {
      const gain = bestDamageShare(content, squishy, target) - now;
      if (gain > 0) {
        options.push({
          value: { type: 'swap', slot },
          weight: sharpen(policy.swap * gain, policy.focus),
        });
      }
    }
  }
  return rng.weighted(options).value;
}

/** Picks who comes out after a tuckered-out squishy. Advances `rng`. */
export function chooseAiReplacement(
  content: BattleContent,
  state: BattleState,
  side: BattleSideId,
  policyId: BattleAiPolicy,
  rng: Rng,
): number {
  const policy = content.rules.ai[policyId];
  const target = activeSquishy(state, otherSide(side));
  const options: Option<number>[] = benchOf(state, side).map(({ slot, squishy }) => ({
    value: slot,
    weight: sharpen(Math.max(MIN_SCORE, bestDamageShare(content, squishy, target)), policy.focus),
  }));
  return rng.weighted(options).value;
}
