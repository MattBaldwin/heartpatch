import { afterEach, describe, expect, it, vi } from 'vitest';
import { ai, battleSetup, FIXTURE_POTIONS, PLAYER, squishy } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_COUNTDOWN as countdown,
  FIXTURE_EFFECT_CONTENT as content,
  FIXTURE_EFFECT_DATA,
  FIXTURE_EFFECT_RULES,
  FIXTURE_FLAT_EFFECT_CONTENT as flat,
  member,
  patchSlot,
  sturdy,
  teamSetup,
  turnLog,
} from '../../tests/fixtures/team-battle.js';
import { Rng } from '../rng/index.js';
import type { BattleChoice, BattleController, BattleSquishySetup } from '../schemas/battle.js';
import { chooseAiChoice } from './ai.js';
import { createBattleContent, type BattleContent } from './content.js';
import { applyBattleAction, legalChoices, startBattle, teamPickOptions } from './engine.js';
import { damageBeforeVariance } from './formulas.js';
import type { BattleState } from './state.js';

afterEach(() => vi.restoreAllMocks());

const COUNT = countdown.id;
const winding = { windup: { move: COUNT } };

/** A one-on-one battle; side `b` is a player too unless `b` says otherwise. */
const duel = (
  seed: string,
  a: BattleSquishySetup[],
  b: BattleSquishySetup[],
  bController: BattleController = PLAYER,
) => battleSetup(seed, { squishies: a }, { controller: bController, squishies: b });

const act = (
  state: BattleState,
  choices: { a?: BattleChoice; b?: BattleChoice },
  using: BattleContent = content,
) => applyBattleAction(using, state, { type: 'turn', choices });

const move = (id: string, item?: string): BattleChoice => ({
  type: 'move',
  move: id,
  ...(item && { item }),
});

/** The effect fixtures plus the fixture potions (#214). */
const potions = createBattleContent(
  { ...FIXTURE_EFFECT_DATA, resources: FIXTURE_POTIONS },
  FIXTURE_EFFECT_RULES,
);
const BREW = 'fixture-brave-brew';
const COCOA = 'fixture-cozy-cocoa';
const SOUP = 'fixture-hearty-soup';

const counterbun = (speed: number) => squishy('fixture-counterbun', { stats: sturdy(speed) });
const bonkbun = (speed: number) => squishy('fixture-bonkbun', { stats: sturdy(speed) });
const shoutbun = (speed: number) => squishy('fixture-shoutbun', { stats: sturdy(speed) });

describe('windup (#234)', () => {
  it('charges with no roll and no stance, then lands next round with the move’s accuracy, damage, stance and effects', () => {
    let state = startBattle(flat, duel('charge', [counterbun(80)], [bonkbun(50), shoutbun(50)]));
    const rng = state.rng;
    // b swaps, so nothing else in the round rolls: any draw would be the charge's.
    state = act(state, { a: move(COUNT), b: { type: 'swap', slot: 1 } }, flat);
    expect(state.rng).toEqual(rng);
    expect(turnLog(state, 1)).toEqual(['swap b0', `move a0 ${COUNT}`, `windup a0 ${COUNT}`]);
    const charged = state.sides.a.squishies[0]!;
    expect(charged.windup).toEqual({ move: COUNT });
    expect(charged.guard).toBeUndefined();
    expect(state.sides.b.squishies[1]!.energy).toBe(500);

    const target = state.sides.b.squishies[1]!;
    const damage = Math.floor(damageBeforeVariance(flat, countdown, charged, target));
    state = act(state, { a: move(COUNT), b: move('fixture-shout') }, flat);
    expect(turnLog(state, 2).slice(0, 3)).toEqual([`move a0 ${COUNT}`, 'hit b1', 'stance a0']);
    const hit = state.log.find((e) => e.turn === 2 && e.type === 'hit' && e.side === 'b');
    expect(hit).toMatchObject({ amount: damage });
    expect(state.log.find((e) => e.turn === 2 && e.type === 'stance')).toMatchObject({
      stance: 'open',
    });
    expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
  });

  it('a pick for a winding-up squishy must be the pending move, in a team battle and one-on-one', () => {
    // One-on-one.
    let state = startBattle(content, duel('pick', [counterbun(80)], [bonkbun(50)]));
    state = act(state, { a: move(COUNT), b: move('fixture-bonk') });
    expect(() => act(state, { a: move('fixture-bonk'), b: move('fixture-bonk') })).toThrow(
      /winding up "fixture-countdown"/,
    );
    const moves = legalChoices(state, 'a', content).flatMap((c) =>
      c.type === 'move' ? [c.move] : [],
    );
    expect(new Set(moves)).toEqual(new Set([COUNT]));
    expect(() => act(state, { a: move(COUNT), b: move('fixture-bonk') })).not.toThrow();

    // Team.
    let team = startBattle(
      content,
      teamSetup('pick', [member(0, 'fixture-counterbun'), member(1, 'fixture-bonkbun')]),
    );
    team = patchSlot(team, 'a', 0, { windup: { move: COUNT, target: 0 } });
    expect(teamPickOptions(team, 'a').map((o) => o.moves)).toEqual([[COUNT], ['fixture-bonk']]);
    const picks = (first: string): BattleChoice => ({
      type: 'team',
      picks: [
        { slot: 0, move: first, target: 0 },
        { slot: 1, move: 'fixture-bonk' },
      ],
    });
    expect(() => act(team, { a: picks('fixture-bonk') })).toThrow(/slot 0 is winding up/);
    const landed = act(team, { a: picks(COUNT) });
    const log = turnLog(landed, 1);
    expect(log[log.indexOf(`move a0 ${COUNT}`) + 1]).toBe('hit b0');
    expect(landed.sides.a.squishies[0]!.windup).toBeUndefined();
  });

  it('re-aims at the first foe standing when its target is tuckered out', () => {
    let state = startBattle(
      content,
      teamSetup('re-aim', [member(0), member(1), member(2)], { speciesId: 'fixture-trickgourd' }),
    );
    state = patchSlot(state, 'a', 2, { energy: 0 });
    state = patchSlot(state, 'b', 0, { windup: { move: COUNT, target: 2 } });
    const next = act(state, {
      a: {
        type: 'team',
        picks: [
          { slot: 0, move: 'fixture-bonk' },
          { slot: 1, move: 'fixture-bonk' },
        ],
      },
    });
    const log = turnLog(next, 1);
    expect(log[log.indexOf(`move b0 ${COUNT}`) + 1]).toBe('hit a0');
  });

  describe('loses the count with a windup-lost event', () => {
    it('on a sleepy (or dizzy) skip', () => {
      let state = startBattle(content, duel('sleepy', [counterbun(80)], [bonkbun(50)]));
      state = patchSlot(state, 'a', 0, { ...winding, status: { id: 'sleepy', turnsLeft: 2 } });
      state = act(state, { a: move(COUNT), b: move('fixture-bonk') });
      expect(turnLog(state, 1).slice(0, 2)).toEqual(['status-skip a0', `windup-lost a0 ${COUNT}`]);
      expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
    });

    it('on a flinch', () => {
      let state = startBattle(content, duel('flinch', [counterbun(30)], [shoutbun(90)]));
      state = patchSlot(state, 'a', 0, winding);
      state = act(state, { a: move(COUNT), b: move('fixture-shout') });
      expect(turnLog(state, 1)).toEqual([
        'move b0 fixture-shout',
        'hit a0',
        'stance b0',
        'flinch a0',
        `windup-lost a0 ${COUNT}`,
      ]);
      expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
    });

    it('on a swap', () => {
      let state = startBattle(content, duel('swap', [counterbun(80), bonkbun(80)], [bonkbun(50)]));
      state = patchSlot(state, 'a', 0, winding);
      state = act(state, { a: { type: 'swap', slot: 1 }, b: move('fixture-bonk') });
      expect(turnLog(state, 1).slice(0, 2)).toEqual([`windup-lost a0 ${COUNT}`, 'swap a0']);
      expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
    });

    it('on a bare potion, before the sip', () => {
      let state = startBattle(potions, duel('bare', [counterbun(80)], [bonkbun(50)]));
      state = patchSlot(state, 'a', 0, winding);
      state = act(state, { a: { type: 'item', item: SOUP }, b: move('fixture-bonk') }, potions);
      expect(turnLog(state, 1).slice(0, 2)).toEqual([`windup-lost a0 ${COUNT}`, 'item a0']);
      expect(turnLog(state, 1)).not.toContain(`move a0 ${COUNT}`);
      expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
      expect(state.sides.a.itemsUsed).toEqual([SOUP]);
    });

    it('on a Heart Charm', () => {
      let state = startBattle(content, duel('charm', [counterbun(80)], [bonkbun(50)], ai('wild')));
      state = patchSlot(state, 'a', 0, winding);
      state = act(state, { a: { type: 'capture' } });
      expect(turnLog(state, 1).slice(0, 2)).toEqual([`windup-lost a0 ${COUNT}`, 'capture b0']);
      expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
    });
  });

  it('a sip with the pending move keeps the count and lands it', () => {
    let state = startBattle(potions, duel('sip', [counterbun(80)], [bonkbun(50)]));
    state = patchSlot(state, 'a', 0, winding);
    state = act(state, { a: move(COUNT, COCOA), b: move('fixture-bonk') }, potions);
    const log = turnLog(state, 1);
    expect(log.slice(0, 3)).toEqual(['item a0', `move a0 ${COUNT}`, 'hit b0']);
    expect(log).not.toContain(`windup-lost a0 ${COUNT}`);
    expect(state.sides.a.squishies[0]!.windup).toBeUndefined();
    expect(state.sides.a.itemsUsed).toEqual([COCOA]);
  });

  it('legal choices while winding up: the pending move, bare and with each potion, a swap, a Heart Charm and the bare potions', () => {
    let state = startBattle(
      potions,
      duel('legal', [counterbun(80), bonkbun(80)], [bonkbun(50)], ai('wild')),
    );
    state = patchSlot(state, 'a', 0, winding);
    expect(legalChoices(state, 'a', potions)).toEqual([
      move(COUNT),
      move(COUNT, BREW),
      move(COUNT, COCOA),
      move(COUNT, SOUP),
      { type: 'swap', slot: 1 },
      { type: 'capture' },
      { type: 'item', item: BREW },
      { type: 'item', item: COCOA },
      { type: 'item', item: SOUP },
    ]);
  });

  it('being hit never interrupts it', () => {
    let state = startBattle(content, duel('hit', [counterbun(80)], [bonkbun(50)]));
    state = act(state, { a: move(COUNT), b: move('fixture-bonk') });
    expect(turnLog(state, 1)).toContain('hit a0');
    expect(state.sides.a.squishies[0]!.windup).toEqual({ move: COUNT });
    state = act(state, { a: move(COUNT), b: move('fixture-bonk') });
    expect(turnLog(state, 2).slice(0, 2)).toEqual([`move a0 ${COUNT}`, 'hit b0']);
  });

  it('an AI side keeps its count without drawing from the RNG', () => {
    let state = startBattle(
      content,
      battleSetup(
        'ai',
        { controller: ai('aggressive'), squishies: [counterbun(80)] },
        { controller: ai('wild'), squishies: [bonkbun(50)] },
      ),
    );
    state = patchSlot(state, 'a', 0, winding);
    const rng = Rng.fromState(state.rng);
    expect(chooseAiChoice(content, state, 'a', 'aggressive', rng)).toEqual(move(COUNT));
    expect(rng.state()).toEqual(state.rng);
  });

  it('the boss lands its count as its one action, and never lands it the round it starts', () => {
    // One foe standing: the boss acts once, and that action is the landing.
    let state = startBattle(
      content,
      teamSetup('boss', [member(0, 'fixture-bonkbun', { stats: sturdy(50) })], {
        speciesId: 'fixture-trickgourd',
      }),
    );
    state = patchSlot(state, 'b', 0, { windup: { move: COUNT, target: 0 } });
    const weighted = vi.spyOn(Rng.prototype, 'weighted');
    const next = act(state, { a: { type: 'team', picks: [{ slot: 0, move: 'fixture-bonk' }] } });
    expect(weighted).not.toHaveBeenCalled();
    expect(turnLog(next, 1).filter((e) => e.startsWith('move b0'))).toEqual([`move b0 ${COUNT}`]);
    expect(next.sides.b.squishies[0]!.windup).toBeUndefined();

    // A boss with two actions that starts a count spends the round on it.
    const windupOnly = createBattleContent(
      {
        ...FIXTURE_EFFECT_DATA,
        species: [
          ...FIXTURE_EFFECT_DATA.species,
          {
            ...FIXTURE_EFFECT_DATA.species.find((s) => s.id === 'fixture-trickgourd')!,
            id: 'fixture-windgourd',
            moves: [COUNT],
          },
        ],
      },
      FIXTURE_EFFECT_RULES,
    );
    expect(windupOnly.rules.boss?.actionsPerRound).toBe(2);
    const three = startBattle(
      windupOnly,
      teamSetup('boss-charge', [member(0), member(1), member(2)], {
        speciesId: 'fixture-windgourd',
      }),
    );
    const bonkAll: BattleChoice = {
      type: 'team',
      picks: [0, 1, 2].map((slot) => ({ slot, move: 'fixture-bonk' })),
    };
    const after = act(three, { a: bonkAll }, windupOnly);
    expect(turnLog(after, 1).filter((e) => e.endsWith(`b0 ${COUNT}`))).toEqual([
      `move b0 ${COUNT}`,
      `windup b0 ${COUNT}`,
    ]);
    expect(after.sides.b.squishies[0]!.windup?.target).toBeTypeOf('number');
  });
});
