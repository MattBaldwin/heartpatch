import type { Rng } from '../rng/index.js';
import type { BattleChoice, BattleSideId } from '../schemas/battle.js';
import type {
  BattleAiPolicy,
  BattleAiPolicyRules,
  BattleMoveKindRules,
} from '../schemas/data/battle.js';
import type { Move } from '../schemas/data/moves.js';
import { getMove, moveKindOf, type BattleContent } from './content.js';
import { expectedDamage, matchupMultiplier } from './formulas.js';
import {
  activeSquishy,
  benchOf,
  inPlay,
  otherSide,
  outOf,
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

/**
 * What a move's stance (#587) is worth to this policy: a steady guard is
 * worth `guard` × the foe's best hit share × guardPercent; a big opening costs
 * `open` × that share × openPercent, unless the move should tucker the target
 * out (then there's no next hit to fear). The stance comes hit or miss.
 */
function stanceScore(
  content: BattleContent,
  policyId: BattleAiPolicy,
  move: Move,
  user: BattleSquishy,
  target: BattleSquishy,
): number {
  const rules: BattleMoveKindRules | undefined = content.rules.moveKinds;
  const kind = moveKindOf(content, user.speciesId, move.id);
  if (!rules || !kind || target.fence !== undefined) return 0;
  const weights = rules.ai[policyId];
  const threat = bestDamageShare(content, target, user);
  if (kind === 'steady') return (weights.guard * threat * rules.guardPercent) / 100;
  if (damageShare(content, move, user, target) >= 1) return 0;
  return -(weights.open * threat * rules.openPercent) / 100;
}

/** How good `move` looks to this policy right now. */
export function scoreMove(
  content: BattleContent,
  policy: BattleAiPolicyRules,
  move: Move,
  user: BattleSquishy,
  target: BattleSquishy,
  policyId?: BattleAiPolicy,
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
  const stance = policyId ? stanceScore(content, policyId, move, user, target) : 0;
  return score * lands + stance;
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
      Math.max(MIN_SCORE, scoreMove(content, policy, getMove(content, id), user, target, policyId)),
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

// ── Team battles (#190) ─────────────────────────────────────────────────

/** The standing squishies `side` has on the field, in slot order. */
export function standingOut(
  state: BattleState,
  side: BattleSideId,
): { slot: number; squishy: BattleSquishy }[] {
  const { squishies } = state.sides[side];
  return outOf(state, side).flatMap((slot) => {
    const squishy = squishies[slot];
    return squishy && inPlay(squishy) ? [{ slot, squishy }] : [];
  });
}

/** Does `move` aim at foes (damage, or a status or stat drop on the foe)? */
function aimsAtFoe(move: Move): boolean {
  return (
    move.power > 0 ||
    (move.effects ?? []).some(
      (e) => e.type === 'status' || (e.type === 'stat' && e.target === 'opponent'),
    )
  );
}

/**
 * How good `move` looks with several foes standing: an `all-foes` move adds
 * up its score against each (at `spreadPercent` when there's more than one),
 * a one-foe move counts its best target.
 */
function teamMoveScore(
  content: BattleContent,
  policy: BattleAiPolicyRules,
  move: Move,
  user: BattleSquishy,
  foes: readonly BattleSquishy[],
): number {
  if (move.targets === 'all-foes' && foes.length > 1) {
    const spread = content.rules.team?.spreadPercent ?? 100;
    let total = 0;
    for (const foe of foes) total += scoreMove(content, policy, move, user, foe);
    return (total * spread) / 100;
  }
  let best = 0;
  for (const foe of foes) best = Math.max(best, scoreMove(content, policy, move, user, foe));
  return best;
}

/**
 * Who a one-foe move from `user` hits (#190), with one seeded pick when more
 * than one foe stands: each weighs the move's matchup against it × (1 +
 * `lowEnergy` × the share of energy it has lost) × `alreadyHitPercent`% if
 * `user` already hit it this round (battle rules `team.target`).
 */
export function chooseTarget(
  content: BattleContent,
  move: Move,
  user: BattleSquishy,
  foes: readonly { slot: number; squishy: BattleSquishy }[],
  alreadyHit: ReadonlySet<number>,
  rng: Rng,
): number {
  const [first] = foes;
  if (!first) throw new RangeError('chooseTarget() needs a foe standing');
  if (foes.length === 1) return first.slot;
  const rules = content.rules.team?.target ?? { lowEnergy: 0, alreadyHitPercent: 100 };
  const options: Option<number>[] = foes.map(({ slot, squishy }) => {
    const lost = (squishy.stats.hp - squishy.energy) / squishy.stats.hp;
    const hit = alreadyHit.has(slot) ? rules.alreadyHitPercent / 100 : 1;
    const weight =
      matchupMultiplier(content, move, user, squishy) * (1 + rules.lowEnergy * lost) * hit;
    return { value: slot, weight: Math.max(MIN_SCORE, weight) };
  });
  return rng.weighted(options).value;
}

/**
 * An AI squishy's move in a team battle (#190) and who it hits: the move by
 * `policy`'s weights against every standing foe (`sharpen`ed like any AI),
 * then a target with `chooseTarget`. An `all-foes` move hits them all in slot
 * order; a move that only helps its user aims at the first foe (it never
 * reaches it). Advances `rng`.
 */
export function chooseTeamMove(
  content: BattleContent,
  state: BattleState,
  side: BattleSideId,
  slot: number,
  policy: BattleAiPolicyRules,
  alreadyHit: ReadonlySet<number>,
  rng: Rng,
): { move: string; targets: number[] } {
  const user = state.sides[side].squishies[slot];
  if (!user) throw new RangeError(`side ${side} has no squishy in slot ${slot}`);
  const foes = standingOut(state, otherSide(side));
  const [first] = foes;
  if (!first) throw new RangeError('chooseTeamMove() needs a foe standing');
  const options: Option<string>[] = user.moves.map((id) => ({
    value: id,
    weight: sharpen(
      Math.max(
        MIN_SCORE,
        teamMoveScore(
          content,
          policy,
          getMove(content, id),
          user,
          foes.map((f) => f.squishy),
        ),
      ),
      policy.focus,
    ),
  }));
  const move = getMove(content, rng.weighted(options).value);
  if (move.targets === 'all-foes') return { move: move.id, targets: foes.map((f) => f.slot) };
  if (!aimsAtFoe(move)) return { move: move.id, targets: [first.slot] };
  return {
    move: move.id,
    targets: [chooseTarget(content, move, user, foes, alreadyHit, rng)],
  };
}
