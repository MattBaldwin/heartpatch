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
  type BattleStats,
  type TeamPick,
} from '../schemas/battle.js';
import type { BattleStat, Move, MoveKind } from '../schemas/data/moves.js';
import { chooseAiChoice, chooseAiReplacement, chooseTeamMove, standingOut } from './ai.js';
import { BattleRuleError, getMove, getSpecies, moveKindOf, type BattleContent } from './content.js';
import {
  captureChance,
  effectiveStat,
  effectivenessTier,
  guardedAmount,
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
  if (setup.format) checkTeamSetup(content, setup);
  const sideFrom = (side: BattleSideId): Draft<BattleState>['sides'][BattleSideId] => {
    const { controller, squishies } = setup.sides[side];
    // A team battle (#190) has its whole side out at once; others one.
    const outCount = setup.format?.[side] ?? 1;
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
      ...(outCount > 1 && { out: squishies.map((_, slot) => slot) }),
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
            joined: slot < outCount,
            boosts: noBoosts(),
            shield: 0,
            fence: s.fence,
          };
        }
        const species = getSpecies(content, s.speciesId);
        for (const move of species.moves) getMove(content, move);
        const plain = s.stats ?? statsAtLevel(species.baseStats, s.level, content.rules);
        const stats = s.boss ? bossStats(content, plain) : plain;
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
          joined: slot < outCount,
          boosts: noBoosts(),
          shield: 0,
          ...(s.boss && { boss: true as const }),
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
    ...(setup.gentle && { gentle: true as const }),
    ...(setup.format && { format: { ...setup.format } }),
    rng: Rng.fromSeed(setup.seed).state(),
    sides: { a: sideFrom('a'), b: sideFrom('b') },
    phase: { type: 'turn' },
    log: [],
  };
}

/**
 * A team battle's setup (#190) keeps the rules: battle rules with a `team`
 * block, side `a` brings exactly `format.a` squishies (all out at once) and
 * side `b` exactly one, AI-controlled. No fences. Only side `b` may bring a
 * boss, and only with a `boss` block in the rules.
 */
function checkTeamSetup(content: BattleContent, setup: BattleSetup): void {
  const { format } = setup;
  if (!format) return;
  if (!content.rules.team) throw new BattleRuleError('these battle rules have no team battles');
  for (const side of SIDES) {
    const { squishies } = setup.sides[side];
    if (squishies.length !== format[side]) {
      throw new BattleRuleError(
        `side ${side} brings ${squishies.length} squishies; a team battle has ${format[side]} out`,
      );
    }
    if (squishies.some(isFenceSetup))
      throw new BattleRuleError('a fence is never in a team battle');
  }
  if (setup.sides.b.controller.type !== 'ai') {
    throw new BattleRuleError('side b of a team battle is AI-controlled');
  }
  const bosses = SIDES.flatMap((side) =>
    setup.sides[side].squishies.flatMap((s) => (!isFenceSetup(s) && s.boss ? [side] : [])),
  );
  if (bosses.some((side) => side !== 'b')) throw new BattleRuleError('only side b brings a boss');
  if (bosses.length > 0 && !content.rules.boss) {
    throw new BattleRuleError('these battle rules have no bosses');
  }
}

/** A boss's stats (#190): its stats at its level × battle rules' `boss.stats` %. */
function bossStats(content: BattleContent, stats: BattleStats): BattleStats {
  const scale = content.rules.boss?.stats;
  if (!scale) throw new BattleRuleError('these battle rules have no bosses');
  const scaled = (value: number, percent: number) =>
    Math.max(1, Math.floor((value * percent) / 100));
  return {
    hp: scaled(stats.hp, scale.hp),
    attack: scaled(stats.attack, scale.attack),
    defense: scaled(stats.defense, scale.defense),
    speed: scaled(stats.speed, scale.speed),
  };
}

/** A writable copy of everything a step can change. Events are never changed, so they're shared. */
function draftOf(state: BattleState): Draft<BattleState> {
  const copySide = (side: BattleState['sides'][BattleSideId]) => ({
    controller: { ...side.controller },
    active: side.active,
    ...(side.out && { out: [...side.out] }),
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
    ...(state.gentle && { gentle: true as const }),
    ...(state.format && { format: { ...state.format } }),
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
  /** Actions the boss lost to dizzy or sleepy this round (#190). */
  private bossSkips = 0;

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

  at(side: BattleSideId, slot = this.state.sides[side].active) {
    return { turn: this.state.turn, side, slot };
  }

  /** The squishy in `side`'s team `slot` (defaults to the one that's out). */
  squishyAt(side: BattleSideId, slot = this.state.sides[side].active): Draft<BattleSquishy> {
    const squishy = this.state.sides[side].squishies[slot];
    if (!squishy) throw new BattleRuleError(`side ${side} has no squishy in slot ${slot}`);
    return squishy;
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

    // Potion sips next (#214), before any move, so a shield is up for this
    // turn's hit. A sip with a move is free (#403): the move still comes
    // below. A bare item choice (battles logged before #403) is the side's
    // whole turn, as it always was.
    for (const side of SIDES) {
      const sip = sipOf(picked[side]);
      if (sip !== undefined) this.useItem(side, sip);
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

  // ── Team battles (#190) ──────────────────────────────────────────────

  /**
   * One round of a team battle: sips first, then every standing squishy out
   * moves in speed order (ties broken by one seeded shuffle of each tied
   * group, drawn only when there is a tie). The boss's first action comes at
   * its speed and each further one closes the round, but it never acts more
   * times than foes are still standing. A squishy tuckered out before its
   * turn sits out. No swaps, no Heart Charms, nobody to replace.
   */
  teamTurn(choices: Partial<Record<BattleSideId, BattleChoice>>): void {
    // Picks in a fixed order (a, then b) so AI rolls replay exactly.
    const picks = { a: this.teamPicksFor('a', choices.a), b: this.teamPicksFor('b', choices.b) };
    this.state.turn += 1;
    this.bossSkips = 0;

    for (const side of SIDES) {
      const choice = choices[side];
      if (choice?.type === 'team' && choice.item) {
        this.useItem(side, choice.item.item, choice.item.slot);
      }
    }

    const order = this.teamOrder();
    const boss = order.find((m) => this.squishyAt(m.side, m.slot).boss === true);
    const extra = boss ? (this.content.rules.boss?.actionsPerRound ?? 1) - 1 : 0;
    for (let i = 0; i < extra && boss; i++) order.push(boss);

    // Who each AI squishy already hit this round, by side and slot.
    const hit = new Map<string, Set<number>>();
    let bossActions = 0;
    for (const { side, slot } of order) {
      const user = this.squishyAt(side, slot);
      if (!inPlay(user)) continue;
      const foes = standingOut(this.state, otherSide(side));
      if (user.boss) {
        // Never more actions than foes still standing.
        if (bossActions >= foes.length) continue;
        bossActions += 1;
      }
      const key = `${side}:${slot}`;
      const already = hit.get(key) ?? new Set<number>();
      hit.set(key, already);
      const pick = picks[side]?.get(slot);
      const { move, targets } = pick
        ? { move: pick.move, targets: this.pickTargets(side, pick) }
        : chooseTeamMove(
            this.content,
            this.state,
            side,
            slot,
            this.aiPolicy(side, user),
            already,
            this.rng,
          );
      this.useMove(side, getMove(this.content, move), slot, targets);
      for (const target of targets) already.add(target);
      this.syncActive();
      this.checkForWinner();
      if (this.over) return;
    }
    this.endTeamTurn();
  }

  /**
   * A player side's validated team picks by slot; null for an AI side (its
   * squishies pick when they move, so they see the field as it is then). An
   * AI side `a` (the balance simulator) picks here, in slot order.
   */
  private teamPicksFor(
    side: BattleSideId,
    given: BattleChoice | undefined,
  ): Map<number, TeamPick> | null {
    const { controller } = this.state.sides[side];
    if (controller.type === 'ai') {
      if (given) throw new BattleRuleError(`side ${side} is AI-controlled; leave its choice out`);
      return null;
    }
    if (!given) throw new BattleRuleError(`side ${side} needs a choice this turn`);
    if (given.type !== 'team') {
      throw new BattleRuleError(`side ${side}: a team battle takes a team choice`);
    }
    const standing = standingOut(this.state, side);
    const picks = new Map<number, TeamPick>();
    for (const pick of given.picks) {
      const out = standing.find((s) => s.slot === pick.slot);
      if (!out) throw new BattleRuleError(`side ${side} has nobody standing in slot ${pick.slot}`);
      if (picks.has(pick.slot)) throw new BattleRuleError(`slot ${pick.slot} picked twice`);
      if (!out.squishy.moves.includes(pick.move)) {
        throw new BattleRuleError(`side ${side}'s slot ${pick.slot} doesn't know "${pick.move}"`);
      }
      if (
        pick.target !== undefined &&
        !standingOut(this.state, otherSide(side)).some((f) => f.slot === pick.target)
      ) {
        throw new BattleRuleError(`side ${side} can't aim at slot ${pick.target}`);
      }
      picks.set(pick.slot, pick);
    }
    if (picks.size !== standing.length) {
      throw new BattleRuleError(`side ${side} needs a pick for each squishy standing`);
    }
    if (given.item) {
      this.checkItem(side, given.item.item);
      if (!standing.some((s) => s.slot === given.item?.slot)) {
        throw new BattleRuleError(`side ${side} has nobody standing in slot ${given.item.slot}`);
      }
    }
    return picks;
  }

  /** AI weights for an AI squishy in a team battle: a boss's own, else its side's policy. */
  private aiPolicy(side: BattleSideId, user: BattleSquishy) {
    const { controller } = this.state.sides[side];
    if (user.boss && this.content.rules.boss) return this.content.rules.boss.ai;
    if (controller.type !== 'ai') throw new BattleRuleError(`side ${side} picks its own moves`);
    return this.content.rules.ai[controller.policy];
  }

  /**
   * Who a player's pick hits: every standing foe for an `all-foes` move, else
   * its target if still standing, or the first foe standing.
   */
  private pickTargets(side: BattleSideId, pick: TeamPick): number[] {
    const foes = standingOut(this.state, otherSide(side)).map((f) => f.slot);
    if (getMove(this.content, pick.move).targets === 'all-foes') return foes;
    if (pick.target !== undefined && foes.includes(pick.target)) return [pick.target];
    return foes.slice(0, 1);
  }

  /**
   * Everyone standing on the field at the start of the round, fastest first.
   * Equal speeds keep side-then-slot order and each tied group is shuffled
   * with the battle's RNG, drawing only when a tie exists.
   */
  private teamOrder(): { side: BattleSideId; slot: number }[] {
    const { rules } = this.content;
    const movers = SIDES.flatMap((side) =>
      standingOut(this.state, side).map(({ slot, squishy }) => ({
        side,
        slot,
        speed: effectiveStat(squishy, 'speed', rules),
      })),
    );
    movers.sort((x, y) => y.speed - x.speed);
    const speed = (i: number) => movers[i]?.speed;
    for (let start = 0; start < movers.length;) {
      let end = start + 1;
      while (end < movers.length && speed(end) === speed(start)) end += 1;
      // Fisher–Yates over the tied group [start, end).
      for (let i = end - 1; i > start; i--) {
        const j = this.rng.int(start, i);
        const [x, y] = [movers[i], movers[j]];
        if (x && y) [movers[i], movers[j]] = [y, x];
      }
      start = end;
    }
    return movers.map(({ side, slot }) => ({ side, slot }));
  }

  /** `active` follows the first standing slot of `out` (#190). */
  private syncActive(): void {
    for (const side of SIDES) {
      const standing = standingOut(this.state, side);
      const first = standing[0];
      if (this.state.sides[side].out && first) this.state.sides[side].active = first.slot;
    }
  }

  /** A team battle's round ends: only the turn limit; nobody is waiting to come out. */
  private endTeamTurn(): void {
    const limit = Math.min(this.state.turnLimit ?? Infinity, this.content.rules.maxTurns);
    if (this.state.turn >= limit) this.end(this.energyLeader(), 'turn-limit');
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
    } else if (given.type === 'team') {
      throw new BattleRuleError(`side ${side}: a team choice is only for a team battle`);
    } else if (given.type === 'item') {
      this.checkItem(side, given.item);
    } else if (given.type === 'move') {
      if (!this.active(side).moves.includes(given.move)) {
        throw new BattleRuleError(`side ${side}'s squishy doesn't know "${given.move}"`);
      }
      if (given.item !== undefined) this.checkItem(side, given.item);
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
  private useItem(side: BattleSideId, item: string, slot = this.state.sides[side].active): void {
    const effect = this.content.items.get(item);
    if (!effect) throw new BattleRuleError(`"${item}" can't be used in battle`);
    const user = this.squishyAt(side, slot);
    this.state.sides[side].itemsUsed.push(item);
    this.emit({ ...this.at(side, slot), type: 'item', item });
    user.boosts.attack += effect.attackPercent ?? 0;
    user.boosts.defense += effect.defensePercent ?? 0;
    user.shield = effect.shieldPercent;
    if (effect.healPercent) this.heal(side, effect.healPercent, slot);
  }

  /** Gives `side`'s squishy in `slot` back `percent`% of full energy, up to full. */
  private heal(side: BattleSideId, percent: number, slot = this.state.sides[side].active): void {
    const user = this.squishyAt(side, slot);
    const restored = Math.floor((user.stats.hp * percent) / 100);
    const amount = Math.min(restored, user.stats.hp - user.energy);
    if (amount === 0) return;
    user.energy += amount;
    this.emit({ ...this.at(side, slot), type: 'heal', amount, energy: user.energy });
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
    delete leaving.guard;
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
  private canAct(side: BattleSideId, slot = this.state.sides[side].active): boolean {
    const user = this.squishyAt(side, slot);
    const status = user.status;
    if (!status) return true;
    // A boss (#190) that has lost its actions for this round shakes it off.
    const shakesOff = (): void => {
      user.status = null;
      this.emit({ ...this.at(side, slot), type: 'status-end', status: status.id });
    };
    const bossSkips = user.boss ? this.content.rules.boss?.statusSkipsPerRound : undefined;
    if (status.turnsLeft === 0 || (bossSkips !== undefined && this.bossSkips >= bossSkips)) {
      shakesOff();
      return true;
    }
    status.turnsLeft -= 1;
    if (this.rng.chance(this.content.rules.status[status.id].skipChance)) {
      this.emit({ ...this.at(side, slot), type: 'status-skip', status: status.id });
      if (bossSkips !== undefined) {
        this.bossSkips += 1;
        if (this.bossSkips >= bossSkips) shakesOff();
      }
      return false;
    }
    return true;
  }

  /**
   * `side`'s squishy in `userSlot` (the one that's out by default) uses
   * `move` on the foes in `targetSlots` (the other side's one that's out by
   * default). Each target is rolled on its own, in the order given: accuracy,
   * then damage, at `rules.team.spreadPercent` when there's more than one
   * (#190). The stance follows, then the move's effects on each target hit.
   */
  private useMove(
    side: BattleSideId,
    move: Move,
    userSlot = this.state.sides[side].active,
    targetSlots: readonly number[] = [this.state.sides[otherSide(side)].active],
  ): void {
    const user = this.squishyAt(side, userSlot);
    if (!inPlay(user) || !this.canAct(side, userSlot)) return;
    const foeSide = otherSide(side);
    const kind = moveKindOf(this.content, user.speciesId, move.id);
    const spread = targetSlots.length > 1 ? (this.content.rules.team?.spreadPercent ?? 100) : 100;

    this.emit({ ...this.at(side, userSlot), type: 'move', move: move.id });
    const landed: number[] = [];
    for (const slot of targetSlots) {
      if (!this.rng.chance(move.accuracy)) {
        this.emit({ ...this.at(side, userSlot), type: 'miss', move: move.id });
        continue;
      }
      landed.push(slot);
      if (move.power > 0) this.hit(side, userSlot, slot, move, kind, spread);
    }
    this.takeStance(side, kind, userSlot);
    if (landed.length === 0) return;

    for (const effect of move.effects ?? []) {
      switch (effect.type) {
        case 'heal':
          this.heal(side, effect.percent, userSlot);
          break;
        case 'stat': {
          const at =
            effect.target === 'self'
              ? [{ who: side, slot: userSlot }]
              : landed.map((slot) => ({ who: foeSide, slot }));
          for (const { who, slot } of at) {
            const squishy = this.squishyAt(who, slot);
            if (squishy.energy === 0 || !this.rng.chance(effect.chance)) continue;
            const { maxStages } = this.content.rules.statStages;
            const before = squishy.stages[effect.stat];
            const after = Math.max(-maxStages, Math.min(maxStages, before + effect.stages));
            squishy.stages[effect.stat] = after;
            this.emit({
              ...this.at(who, slot),
              type: 'stat-change',
              stat: effect.stat,
              stages: after - before,
              total: after,
            });
          }
          break;
        }
        case 'status': {
          for (const slot of landed) {
            const target = this.squishyAt(foeSide, slot);
            if (target.energy === 0 || target.status || !this.rng.chance(effect.chance)) continue;
            const rule = this.content.rules.status[effect.status];
            target.status = {
              id: effect.status,
              turnsLeft: this.rng.int(rule.minTurns, rule.maxTurns),
            };
            this.emit({ ...this.at(foeSide, slot), type: 'status-start', status: effect.status });
          }
          break;
        }
      }
    }
  }

  /** One landed damaging move into the foe in `slot`, at `spread`% (#190; 100 is full). */
  private hit(
    side: BattleSideId,
    userSlot: number,
    slot: number,
    move: Move,
    kind: MoveKind | undefined,
    spread: number,
  ): void {
    const { rules } = this.content;
    const foeSide = otherSide(side);
    const user = this.squishyAt(side, userSlot);
    const target = this.squishyAt(foeSide, slot);
    const full = rollDamage(this.content, move, user, target, this.rng);
    const rolled =
      spread < 100 ? Math.max(rules.damage.minimum, Math.floor((full * spread) / 100)) : full;
    const guard = target.guard ?? 0;
    const shielded = target.shield > 0;
    let amount = Math.min(
      target.energy,
      shieldedAmount(guardedAmount(rolled, guard, rules), target.shield, rules),
    );
    // Gentle (#587): a player's steady move leaves a sliver of energy.
    let gentle = false;
    if (kind === 'steady' && rules.moveKinds && this.gentleInto(side)) {
      const most = Math.max(0, target.energy - rules.moveKinds.gentleFloor);
      if (amount > most) {
        amount = most;
        gentle = true;
      }
    }
    target.shield = 0;
    delete target.guard;
    target.energy -= amount;
    const effectiveness = effectivenessTier(
      matchupMultiplier(this.content, move, user, target),
      rules,
    );
    this.emit({
      ...this.at(foeSide, slot),
      type: 'hit',
      amount,
      energy: target.energy,
      effectiveness,
      ...(shielded && { shielded: true as const }),
      ...(guard > 0 && { guarded: true as const }),
      ...(guard < 0 && { opened: true as const }),
      ...(gentle && { gentle: true as const }),
    });
    if (target.energy === 0) this.emit({ ...this.at(foeSide, slot), type: 'tuckered-out' });
  }

  /**
   * A gentle battle (#587) spares the AI side from a player's steady moves:
   * only a battle whose squishies can be befriended, never a fence.
   */
  private gentleInto(side: BattleSideId): boolean {
    const foeSide = otherSide(side);
    return (
      this.state.gentle === true &&
      this.state.sides[side].controller.type === 'player' &&
      this.state.sides[foeSide].controller.type === 'ai' &&
      this.active(foeSide).fence === undefined
    );
  }

  /**
   * The user's stance after a steady or big move (#587), hit or miss: a
   * steady guard or a big opening, replacing any it had, until the next hit
   * it takes. A move with no kind (or rules before #587) changes nothing.
   */
  private takeStance(
    side: BattleSideId,
    kind: MoveKind | undefined,
    slot = this.state.sides[side].active,
  ): void {
    const rules = this.content.rules.moveKinds;
    if (!kind || !rules) return;
    const user = this.squishyAt(side, slot);
    if (!inPlay(user)) return;
    // A finishing blow takes no stance: there's no next hit to brace for.
    if (!this.state.sides[otherSide(side)].squishies.some(inPlay)) return;
    user.guard = kind === 'steady' ? rules.guardPercent : -rules.openPercent;
    this.emit({
      ...this.at(side, slot),
      type: 'stance',
      stance: kind === 'steady' ? 'guard' : 'open',
    });
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
      if (state.format) step.teamTurn(action.choices);
      else step.turn(action.choices);
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
  const { version, contentHash, turn, turnLimit, gentle, format, sides, phase, log } = state;
  return {
    version,
    contentHash,
    turn,
    ...(turnLimit !== undefined && { turnLimit }),
    ...(gentle && { gentle }),
    ...(format && { format }),
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

/** The potion a choice sips this turn (#214, #403), if any. */
export function sipOf(choice: BattleChoice | null | undefined): string | undefined {
  if (choice?.type === 'item') return choice.item;
  if (choice?.type === 'move') return choice.item;
  if (choice?.type === 'team') return choice.item?.item;
  return undefined;
}

/**
 * Every choice a side could legally make this turn (for the UI and tests).
 * Battle items are listed when `content` is given: player sides only, and
 * whether the bag holds one is the server's to check. Each is listed as a
 * free sip with every move (#403), and bare, as a sip with no move.
 */
export function legalChoices(
  state: BattleState,
  side: BattleSideId,
  content?: BattleContent,
): BattleChoice[] {
  if (state.phase.type !== 'turn') return [];
  // A team battle (#190) takes one `team` choice: see `teamPickOptions`.
  if (state.format) return [];
  // A fence (#203) never chooses anything.
  if (activeSquishy(state, side).fence !== undefined) return [];
  const items =
    content && state.sides[side].controller.type === 'player'
      ? [...content.items.keys()].filter((item) => !itemRefusal(content, state, side, item))
      : [];
  const moves = activeSquishy(state, side).moves;
  return [
    ...moves.map((move): BattleChoice => ({ type: 'move', move })),
    ...items.flatMap((item) => moves.map((move): BattleChoice => ({ type: 'move', move, item }))),
    ...benchOf(state, side).map(({ slot }): BattleChoice => ({ type: 'swap', slot })),
    ...(state.sides[side].controller.type === 'player' &&
    state.sides[otherSide(side)].controller.type === 'ai' &&
    activeSquishy(state, otherSide(side)).fence === undefined
      ? [{ type: 'capture' } as const]
      : []),
    ...items.map((item): BattleChoice => ({ type: 'item', item })),
  ];
}

/**
 * What each squishy `side` has standing can do in a team battle round (#190):
 * its slot, its moves, and the foe slots it may aim at. Empty outside one.
 */
export function teamPickOptions(
  state: BattleState,
  side: BattleSideId,
): { slot: number; moves: readonly string[]; targets: number[] }[] {
  if (state.phase.type !== 'turn' || !state.format) return [];
  const targets = standingOut(state, otherSide(side)).map((f) => f.slot);
  return standingOut(state, side).map(({ slot, squishy }) => ({
    slot,
    moves: squishy.moves,
    targets,
  }));
}
