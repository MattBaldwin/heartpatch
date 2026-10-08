import { FENCE_RULES } from '../data/fences.js';
import { Rng } from '../rng/index.js';
import {
  BattleSetupSchema,
  BattleSideIdSchema,
  isFenceSetup,
  type BattleAction,
  type BattleChoice,
  type BattleSetup,
  type BattleSideId,
} from '../schemas/battle.js';
import type { BattleStat, Move } from '../schemas/data/moves.js';
import { chooseAiChoice, chooseAiReplacement } from './ai.js';
import { BattleRuleError, getMove, getSpecies, type BattleContent } from './content.js';
import {
  captureChance,
  effectiveStat,
  effectivenessTier,
  matchupMultiplier,
  rollDamage,
  shieldedAmount,
  statsAtLevel,
} from './formulas.js';
import {
  activeSquishy,
  benchOf,
  inPlay,
  otherSide,
  type BattleEndReason,
  type BattleBoostStat,
  type BattleEvent,
  type BattleResult,
  type BattleSquishy,
  type BattleState,
  type BattleXpAward,
  type Draft,
} from './state.js';

/*
 * The battle reducer (design doc §6, tech spec §8).
 *
 * The spec writes it as `(state, action, seed) → newState`. Here the seed is
 * used once, by `startBattle`, and the RNG's state is then stored in the
 * battle state. So every step is a pure function of (state, action): the
 * same inputs always give the same output, nothing reads a clock or
 * `Math.random()`, and inputs are never changed. A stored battle is just
 * `setup` (which holds the seed) plus the list of actions, and
 * `replayBattle` rebuilds it exactly.
 */

const SIDES = BattleSideIdSchema.options;

const freshStages = (): Record<BattleStat, number> => ({ attack: 0, defense: 0, speed: 0 });
const noBoosts = (): Record<BattleBoostStat, number> => ({ attack: 0, defense: 0 });

/** Builds the first state from a setup. Throws if the setup breaks the rules. */
export function startBattle(content: BattleContent, input: BattleSetup): BattleState {
  const setup = BattleSetupSchema.parse(input);
  const sideFrom = (side: BattleSideId): Draft<BattleState>['sides'][BattleSideId] => {
    const { controller, squishies } = setup.sides[side];
    if (squishies.length > content.rules.teamSize) {
      throw new BattleRuleError(
        `side ${side} brings ${squishies.length} squishies; the limit is ${content.rules.teamSize}`,
      );
    }
    // A fence (#203) stands alone, played by the engine: it never chooses.
    if (squishies.some(isFenceSetup) && (squishies.length > 1 || controller.type !== 'ai')) {
      throw new BattleRuleError(`side ${side}: a fence stands alone on an AI side`);
    }
    return {
      controller: { ...controller },
      active: 0,
      squishies: squishies.map((s, slot) => {
        if (isFenceSetup(s)) {
          if (s.energy > s.stats.hp) {
            throw new BattleRuleError(`fence "${s.id}" starts with more energy than it holds`);
          }
          return {
            id: s.id,
            speciesId: s.fence,
            level: s.level,
            element: s.element,
            feeling: FENCE_RULES.battle.feeling,
            stats: { ...s.stats },
            moves: [],
            energy: s.energy,
            stages: freshStages(),
            status: null,
            joined: slot === 0,
            boosts: noBoosts(),
            shield: 0,
            fence: s.fence,
          };
        }
        const species = getSpecies(content, s.speciesId);
        for (const move of species.moves) getMove(content, move);
        const stats = s.stats ?? statsAtLevel(species.baseStats, s.level, content.rules);
        return {
          id: s.id,
          speciesId: species.id,
          level: s.level,
          element: s.element ?? species.element,
          feeling: s.feeling ?? species.feeling,
          stats: { ...stats },
          moves: [...species.moves],
          energy: stats.hp,
          stages: freshStages(),
          status: null,
          joined: slot === 0,
          boosts: noBoosts(),
          shield: 0,
        };
      }),
      itemsUsed: [],
    };
  };
  return {
    version: 1,
    contentHash: content.contentHash,
    turn: 0,
    ...(setup.turnLimit !== undefined &&
      setup.turnLimit < content.rules.maxTurns && { turnLimit: setup.turnLimit }),
    rng: Rng.fromSeed(setup.seed).state(),
    sides: { a: sideFrom('a'), b: sideFrom('b') },
    phase: { type: 'turn' },
    log: [],
  };
}

/** A writable copy of everything a step can change. Events are never changed, so they're shared. */
function draftOf(state: BattleState): Draft<BattleState> {
  const copySide = (side: BattleState['sides'][BattleSideId]) => ({
    controller: { ...side.controller },
    active: side.active,
    squishies: side.squishies.map((s) => ({
      ...s,
      stats: { ...s.stats },
      moves: [...s.moves],
      stages: { ...s.stages },
      status: s.status && { ...s.status },
      boosts: { ...s.boosts },
    })),
    itemsUsed: [...side.itemsUsed],
  });
  return {
    version: state.version,
    contentHash: state.contentHash,
    turn: state.turn,
    ...(state.turnLimit !== undefined && { turnLimit: state.turnLimit }),
    rng: [...state.rng],
    sides: { a: copySide(state.sides.a), b: copySide(state.sides.b) },
    phase: structuredPhase(state.phase),
    log: [...state.log],
  };
}

function structuredPhase(phase: BattleState['phase']): Draft<BattleState>['phase'] {
  switch (phase.type) {
    case 'turn':
      return { type: 'turn' };
    case 'replace':
      return { type: 'replace', sides: [...phase.sides] };
    case 'over':
      return {
        type: 'over',
        result: { ...phase.result, xp: phase.result.xp.map((x) => ({ ...x })) },
      };
  }
}

/** One step's working state: a private draft and RNG. */
class Step {
  readonly content: BattleContent;
  readonly state: Draft<BattleState>;
  readonly rng: Rng;

  constructor(content: BattleContent, state: BattleState) {
    this.content = content;
    this.state = draftOf(state);
    this.rng = Rng.fromState(state.rng);
  }

  finish(): BattleState {
    this.state.rng = [...this.rng.state()];
    return this.state;
  }

  emit(event: BattleEvent): void {
    this.state.log.push(event);
  }

  active(side: BattleSideId): Draft<BattleSquishy> {
    return activeSquishy(this.state, side);
  }

  at(side: BattleSideId) {
    return { turn: this.state.turn, side, slot: this.state.sides[side].active };
  }

  get over(): boolean {
    return this.state.phase.type === 'over';
  }

  // ── Turns ────────────────────────────────────────────────────────────

  turn(choices: Partial<Record<BattleSideId, BattleChoice>>): void {
    // AI sides pick in a fixed order (a, then b) so their rolls replay exactly.
    const picked = { a: this.choiceFor('a', choices.a), b: this.choiceFor('b', choices.b) };

    this.state.turn += 1;

    // Swaps happen before moves; a swap is the side's whole turn.
    for (const side of SIDES) {
      const choice = picked[side];
      if (choice?.type === 'swap') this.swap(side, choice.slot);
    }

    // Battle items next (potions, #214): the side's whole turn too, before
    // any move, so a shield is up for this turn's hit.
    for (const side of SIDES) {
      const choice = picked[side];
      if (choice?.type === 'item') this.useItem(side, choice.item);
    }

    // Heart Charms next; a squishy that says yes leaves the fight (#279), and
    // the battle ends if it was the last one. Also the side's whole turn.
    for (const side of SIDES) {
      const choice = picked[side];
      if (choice?.type !== 'capture') continue;
      this.capture(side, choice.sure === true);
      if (this.over) return;
    }

    const movers = SIDES.filter((side) => picked[side]?.type === 'move');
    for (const side of this.speedOrder(movers)) {
      const choice = picked[side];
      if (choice?.type !== 'move') continue;
      this.useMove(side, getMove(this.content, choice.move));
      this.checkForWinner();
      if (this.over) return;
    }
    this.endTurn();
  }

  /**
   * The player's validated choice, or the AI's pick for an AI side. A fence
   * (#203) picks nothing: it just stands there.
   */
  private choiceFor(side: BattleSideId, given: BattleChoice | undefined): BattleChoice | null {
    const { controller } = this.state.sides[side];
    if (this.active(side).fence !== undefined) {
      if (given) throw new BattleRuleError(`side ${side} is a fence; leave its choice out`);
      return null;
    }
    if (controller.type === 'ai') {
      if (given) throw new BattleRuleError(`side ${side} is AI-controlled; leave its choice out`);
      return chooseAiChoice(this.content, this.state, side, controller.policy, this.rng);
    }
    if (!given) throw new BattleRuleError(`side ${side} needs a choice this turn`);
    if (given.type === 'capture') {
      if (this.state.sides[otherSide(side)].controller.type !== 'ai') {
        throw new BattleRuleError(`side ${side} can only befriend an AI side's squishy`);
      }
      if (this.active(otherSide(side)).fence !== undefined) {
        throw new BattleRuleError(`side ${side} can't befriend a fence`);
      }
    } else if (given.type === 'item') {
      this.checkItem(side, given.item);
    } else if (given.type === 'move') {
      if (!this.active(side).moves.includes(given.move)) {
        throw new BattleRuleError(`side ${side}'s squishy doesn't know "${given.move}"`);
      }
    } else {
      this.checkBenchSlot(side, given.slot);
    }
    return given;
  }

  /** A battle item this side may still use (`itemRefusal`). */
  private checkItem(side: BattleSideId, item: string): void {
    switch (itemRefusal(this.content, this.state, side, item)) {
      case 'not-an-item':
        throw new BattleRuleError(`"${item}" can't be used in battle`);
      case 'used-up':
        throw new BattleRuleError(`side ${side} already used "${item}" this battle`);
      case null:
        return;
    }
  }

  /**
   * The active squishy uses a battle item (#214): boosts last the rest of
   * the battle, a heal gives back a share of full energy, and the shield
   * replaces any shield it had. No roll, so a potion always works.
   */
  private useItem(side: BattleSideId, item: string): void {
    const effect = this.content.items.get(item);
    if (!effect) throw new BattleRuleError(`"${item}" can't be used in battle`);
    const user = this.active(side);
    this.state.sides[side].itemsUsed.push(item);
    this.emit({ ...this.at(side), type: 'item', item });
    user.boosts.attack += effect.attackPercent ?? 0;
    user.boosts.defense += effect.defensePercent ?? 0;
    user.shield = effect.shieldPercent;
    if (effect.healPercent) this.heal(side, effect.healPercent);
  }

  /** Gives `side`'s active squishy back `percent`% of full energy, up to full. */
  private heal(side: BattleSideId, percent: number): void {
    const user = this.active(side);
    const restored = Math.floor((user.stats.hp * percent) / 100);
    const amount = Math.min(restored, user.stats.hp - user.energy);
    if (amount === 0) return;
    user.energy += amount;
    this.emit({ ...this.at(side), type: 'heal', amount, energy: user.energy });
  }

  private checkBenchSlot(side: BattleSideId, slot: number): void {
    if (!benchOf(this.state, side).some((b) => b.slot === slot)) {
      throw new BattleRuleError(`side ${side} can't send out slot ${slot}`);
    }
  }

  /** Faster squishies go first; an exact tie is a seeded coin flip. */
  private speedOrder(sides: BattleSideId[]): BattleSideId[] {
    const [first, second] = sides;
    if (first === undefined || second === undefined) return sides;
    const { rules } = this.content;
    const a = effectiveStat(this.active(first), 'speed', rules);
    const b = effectiveStat(this.active(second), 'speed', rules);
    if (a > b) return [first, second];
    if (b > a) return [second, first];
    return this.rng.chance(50) ? [first, second] : [second, first];
  }

  private swap(side: BattleSideId, slot: number): void {
    const leaving = this.active(side);
    leaving.stages = freshStages();
    if (leaving.status && this.content.rules.status[leaving.status.id].clearsOnSwap) {
      leaving.status = null;
    }
    this.emit({ ...this.at(side), type: 'swap', to: slot });
    this.sendOut(side, slot);
  }

  private sendOut(side: BattleSideId, slot: number): void {
    this.state.sides[side].active = slot;
    this.active(side).joined = true;
  }

  /**
   * `side` offers a Heart Charm to the other side's squishy: one seeded roll
   * against `captureChance` (none when `sure`). Caught, it's befriended and
   * leaves the fight like a knockout (owner decision on #279): the next one
   * steps in at the end of the turn, and if nobody is left the battle ends
   * with `side` the winner. A wild battle has one squishy, so a catch still
   * ends it at once.
   */
  private capture(side: BattleSideId, sure: boolean): void {
    const foeSide = otherSide(side);
    const target = this.active(foeSide);
    const species = getSpecies(this.content, target.speciesId);
    const caught =
      sure || this.rng.chance(captureChance(target, species.rarity, this.content.rules));
    this.emit({ ...this.at(foeSide), type: 'capture', caught });
    if (!caught) return;
    // The last one standing ends the battle `captured` while still out, as
    // wild befriends always have (so their stored bytes are unchanged); only
    // one that leaves mid-battle is marked.
    const others = this.state.sides[foeSide].squishies.some((s) => s !== target && inPlay(s));
    if (others) target.befriended = true;
    else this.end(side, 'captured');
  }

  // ── Moves ────────────────────────────────────────────────────────────

  /** Sleepy and dizzy squishies may miss their turn. Returns true if it can act. */
  private canAct(side: BattleSideId): boolean {
    const user = this.active(side);
    const status = user.status;
    if (!status) return true;
    if (status.turnsLeft === 0) {
      user.status = null;
      this.emit({ ...this.at(side), type: 'status-end', status: status.id });
      return true;
    }
    status.turnsLeft -= 1;
    if (this.rng.chance(this.content.rules.status[status.id].skipChance)) {
      this.emit({ ...this.at(side), type: 'status-skip', status: status.id });
      return false;
    }
    return true;
  }

  private useMove(side: BattleSideId, move: Move): void {
    const user = this.active(side);
    if (!inPlay(user) || !this.canAct(side)) return;
    const foeSide = otherSide(side);
    const target = this.active(foeSide);

    this.emit({ ...this.at(side), type: 'move', move: move.id });
    if (!this.rng.chance(move.accuracy)) {
      this.emit({ ...this.at(side), type: 'miss', move: move.id });
      return;
    }

    if (move.power > 0) {
      const rolled = rollDamage(this.content, move, user, target, this.rng);
      const shielded = target.shield > 0;
      const amount = Math.min(
        target.energy,
        shieldedAmount(rolled, target.shield, this.content.rules),
      );
      target.shield = 0;
      target.energy -= amount;
      const effectiveness = effectivenessTier(
        matchupMultiplier(this.content, move, user, target),
        this.content.rules,
      );
      this.emit({
        ...this.at(foeSide),
        type: 'hit',
        amount,
        energy: target.energy,
        effectiveness,
        ...(shielded && { shielded: true as const }),
      });
      if (target.energy === 0) this.emit({ ...this.at(foeSide), type: 'tuckered-out' });
    }

    for (const effect of move.effects ?? []) {
      switch (effect.type) {
        case 'heal':
          this.heal(side, effect.percent);
          break;
        case 'stat': {
          const who = effect.target === 'self' ? side : foeSide;
          const squishy = this.active(who);
          if (squishy.energy === 0 || !this.rng.chance(effect.chance)) break;
          const { maxStages } = this.content.rules.statStages;
          const before = squishy.stages[effect.stat];
          const after = Math.max(-maxStages, Math.min(maxStages, before + effect.stages));
          squishy.stages[effect.stat] = after;
          this.emit({
            ...this.at(who),
            type: 'stat-change',
            stat: effect.stat,
            stages: after - before,
            total: after,
          });
          break;
        }
        case 'status': {
          if (target.energy === 0 || target.status || !this.rng.chance(effect.chance)) break;
          const rule = this.content.rules.status[effect.status];
          target.status = {
            id: effect.status,
            turnsLeft: this.rng.int(rule.minTurns, rule.maxTurns),
          };
          this.emit({ ...this.at(foeSide), type: 'status-start', status: effect.status });
          break;
        }
      }
    }
  }

  // ── End of turn and end of battle ────────────────────────────────────

  private checkForWinner(): void {
    for (const side of SIDES) {
      if (!this.state.sides[side].squishies.some(inPlay)) {
        this.end(otherSide(side), 'tuckered-out');
        return;
      }
    }
  }

  private endTurn(): void {
    const limit = Math.min(this.state.turnLimit ?? Infinity, this.content.rules.maxTurns);
    if (this.state.turn >= limit) {
      this.end(this.fenceHolder() ?? this.energyLeader(), 'turn-limit');
      return;
    }
    const waiting: BattleSideId[] = [];
    for (const side of SIDES) {
      if (inPlay(this.active(side))) continue;
      const { controller } = this.state.sides[side];
      if (controller.type === 'player') {
        waiting.push(side);
      } else {
        this.replace(
          side,
          chooseAiReplacement(this.content, this.state, side, controller.policy, this.rng),
        );
      }
    }
    if (waiting.length > 0) this.state.phase = { type: 'replace', sides: waiting };
  }

  replace(side: BattleSideId, slot: number): void {
    this.checkBenchSlot(side, slot);
    this.sendOut(side, slot);
    this.emit({ ...this.at(side), type: 'replace' });
  }

  /** A side whose fence (#203) is still standing: at the turn limit, it held. */
  private fenceHolder(): BattleSideId | null {
    return (
      SIDES.find((side) =>
        this.state.sides[side].squishies.some((s) => s.fence !== undefined && s.energy > 0),
      ) ?? null
    );
  }

  /** The side with more of its total energy left; equal shares are a draw. */
  private energyLeader(): BattleSideId | 'draw' {
    const share = (side: BattleSideId) => {
      const squishies = this.state.sides[side].squishies;
      return {
        // A befriended squishy (#279) has left: none of its energy counts.
        left: squishies.reduce((sum, s) => sum + (s.befriended ? 0 : s.energy), 0),
        full: squishies.reduce((sum, s) => sum + s.stats.hp, 0),
      };
    };
    const a = share('a');
    const b = share('b');
    // Cross-multiplied so the comparison is exact integer maths.
    const diff = a.left * b.full - b.left * a.full;
    return diff > 0 ? 'a' : diff < 0 ? 'b' : 'draw';
  }

  end(winner: BattleSideId | 'draw', reason: BattleEndReason): void {
    this.emit({ turn: this.state.turn, type: 'battle-end', winner, reason });
    this.state.phase = {
      type: 'over',
      result: {
        winner,
        reason,
        contentHash: this.state.contentHash,
        turns: this.state.turn,
        xp: this.xpAwards(winner, reason),
      },
    };
  }

  /**
   * Base battle XP for every squishy that came out (battle rules `xp`). A
   * side that runs away earns nothing, and the `minimum` only counts once a
   * turn was played, so "start a battle, run away" is never an XP loop.
   */
  private xpAwards(winner: BattleSideId | 'draw', reason: BattleEndReason): BattleXpAward[] {
    const { perOpponentLevel, winMultiplier, minimum } = this.content.rules.xp;
    const floor = this.state.turn > 0 ? minimum : 0;
    return SIDES.flatMap((side) => {
      const levels = this.state.sides[otherSide(side)].squishies
        .filter((s) => s.energy === 0)
        .reduce((sum, s) => sum + s.level, 0);
      const multiplier = winner === side ? winMultiplier : 1;
      const ranAway = reason === 'forfeit' && winner !== side;
      const xp = ranAway ? 0 : Math.max(floor, Math.floor(perOpponentLevel * levels * multiplier));
      return this.state.sides[side].squishies
        .filter((s) => s.joined)
        .map((s) => ({ side, squishyId: s.id, xp }));
    });
  }
}

/**
 * Applies one action and returns the next state. Pure: `state` and `action`
 * are not changed, and the same inputs always give the same result. Throws
 * `BattleRuleError` for an action the current phase doesn't allow.
 *
 * `action` is trusted to match `BattleActionSchema`: the API or WebSocket
 * layer parses it at the boundary (CLAUDE.md). The rule checks here still
 * reject unknown moves and slots.
 */
export function applyBattleAction(
  content: BattleContent,
  state: BattleState,
  action: BattleAction,
): BattleState {
  const { phase } = state;
  if (phase.type === 'over') throw new BattleRuleError('the battle is over');
  if (state.contentHash !== content.contentHash) {
    throw new BattleRuleError(
      `battle was played with content ${state.contentHash}, not ${content.contentHash}`,
    );
  }
  const step = new Step(content, state);

  switch (action.type) {
    case 'turn':
      if (phase.type !== 'turn') {
        throw new BattleRuleError(
          `waiting for side ${phase.sides.join(' and ')} to send someone out`,
        );
      }
      step.turn(action.choices);
      break;
    case 'replace': {
      if (phase.type !== 'replace' || !phase.sides.includes(action.side)) {
        throw new BattleRuleError(`side ${action.side} has nobody to replace`);
      }
      step.replace(action.side, action.slot);
      const waiting = phase.sides.filter((s) => s !== action.side);
      step.state.phase =
        waiting.length > 0 ? { type: 'replace', sides: waiting } : { type: 'turn' };
      break;
    }
    case 'forfeit':
      if (state.sides[action.side].controller.type === 'ai') {
        throw new BattleRuleError(`side ${action.side} is AI-controlled; it can't forfeit`);
      }
      step.emit({ turn: state.turn, type: 'forfeit', side: action.side });
      step.end(otherSide(action.side), 'forfeit');
      break;
  }
  return step.finish();
}

/** Rebuilds a battle from its setup (with the seed) and its action log. */
export function replayBattle(
  content: BattleContent,
  setup: BattleSetup,
  actions: readonly BattleAction[],
): BattleState {
  return actions.reduce(
    (state, action) => applyBattleAction(content, state, action),
    startBattle(content, setup),
  );
}

/**
 * Replays a stored `BattleRecord`. Throws if `content` isn't what the battle
 * was played with: after re-tuning, the stored `result` and `log` are the
 * truth, and a replay would quietly tell a different story.
 */
export function replayBattleRecord(content: BattleContent, record: BattleRecord): BattleState {
  if (record.contentHash !== content.contentHash) {
    throw new BattleRuleError(
      `battle was played with content ${record.contentHash}, not ${content.contentHash}`,
    );
  }
  return replayBattle(content, record.setup, record.actions);
}

/**
 * Plays a battle where both sides are AI-controlled to the end (offline
 * raids and the balance simulator). Returns the final state and the action
 * log, which `replayBattle` turns back into the same state.
 */
export function autoplayBattle(
  content: BattleContent,
  setup: BattleSetup,
): { state: BattleState; actions: BattleAction[] } {
  for (const side of SIDES) {
    if (setup.sides[side].controller.type !== 'ai') {
      throw new BattleRuleError(`autoplay needs both sides AI-controlled; side ${side} is not`);
    }
  }
  const actions: BattleAction[] = [];
  let state = startBattle(content, setup);
  while (state.phase.type !== 'over') {
    const action: BattleAction = { type: 'turn', choices: {} };
    actions.push(action);
    state = applyBattleAction(content, state, action);
  }
  return { state, actions };
}

/** A battle as a client may see it: everything but the RNG state. */
export type ClientBattleView = Omit<BattleState, 'rng'>;

/**
 * What the server sends players. The RNG state (and the setup's seed) would
 * let a client predict every roll, so they never leave the server.
 */
export function clientBattleView(state: BattleState): ClientBattleView {
  const { version, contentHash, turn, turnLimit, sides, phase, log } = state;
  return {
    version,
    contentHash,
    turn,
    ...(turnLimit !== undefined && { turnLimit }),
    sides,
    phase,
    log,
  };
}

/**
 * What to store for a finished battle: the replay inputs (setup with its
 * seed, and the actions) plus what actually happened (the content hash, the
 * result and the resolved event log), so a battle stays explainable even
 * after the data is re-tuned and it no longer replays the same way.
 */
export interface BattleRecord {
  readonly setup: BattleSetup;
  readonly actions: readonly BattleAction[];
  readonly contentHash: string;
  readonly result: BattleResult;
  readonly log: readonly BattleEvent[];
}

export function battleRecord(
  setup: BattleSetup,
  actions: readonly BattleAction[],
  state: BattleState,
): BattleRecord {
  if (state.phase.type !== 'over') throw new BattleRuleError('the battle is not over yet');
  return {
    setup,
    actions,
    contentHash: state.contentHash,
    result: state.phase.result,
    log: state.log,
  };
}

/**
 * Why `side` can't use `item` now (#214), or null if it can: it isn't a
 * battle item, or the side already used `rules.items.usesEach` of that kind
 * this battle. The engine, `legalChoices` and the server all ask this, so the
 * rule lives in one place. Whether the bag holds one is the server's to check.
 */
export function itemRefusal(
  content: BattleContent,
  state: Pick<BattleState, 'sides'>,
  side: BattleSideId,
  item: string,
): 'not-an-item' | 'used-up' | null {
  if (!content.items.has(item)) return 'not-an-item';
  const used = state.sides[side].itemsUsed.filter((id) => id === item).length;
  return used >= content.rules.items.usesEach ? 'used-up' : null;
}

/**
 * Every choice a side could legally make this turn (for the UI and tests).
 * Battle items are listed when `content` is given: player sides only, and
 * whether the bag holds one is the server's to check.
 */
export function legalChoices(
  state: BattleState,
  side: BattleSideId,
  content?: BattleContent,
): BattleChoice[] {
  if (state.phase.type !== 'turn') return [];
  // A fence (#203) never chooses anything.
  if (activeSquishy(state, side).fence !== undefined) return [];
  const items =
    content && state.sides[side].controller.type === 'player'
      ? [...content.items.keys()].filter((item) => !itemRefusal(content, state, side, item))
      : [];
  return [
    ...activeSquishy(state, side).moves.map((move): BattleChoice => ({ type: 'move', move })),
    ...benchOf(state, side).map(({ slot }): BattleChoice => ({ type: 'swap', slot })),
    ...(state.sides[side].controller.type === 'player' &&
    state.sides[otherSide(side)].controller.type === 'ai' &&
    activeSquishy(state, otherSide(side)).fence === undefined
      ? [{ type: 'capture' } as const]
      : []),
    ...items.map((item): BattleChoice => ({ type: 'item', item })),
  ];
}
