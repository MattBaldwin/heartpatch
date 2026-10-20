import { describe, expect, it } from 'vitest';
import {
  FIXTURE_BATTLE_CONTENT,
  FIXTURE_BATTLE_DATA,
  FIXTURE_BATTLE_RULES,
  PLAYER,
  ai,
  battleSetup,
  patchActive,
  squishy,
} from '../../tests/fixtures/battle.js';
import { BATTLE_RULES } from '../data/battle.js';
import { GAME_DATA } from '../data/index.js';
import { SERVER_GAME_DATA } from '../data/server/index.js';
import { serverBattleData } from '../data/server/battle-data.js';
import type { BattleAction, BattleChoice } from '../schemas/battle.js';
import type { Move } from '../schemas/data/moves.js';
import { scoreMove } from './ai.js';
import { createBattleContent, moveKindOf } from './content.js';
import { applyBattleAction, clientBattleView, replayBattle, startBattle } from './engine.js';
import { moveKindProblems, speciesMoveKinds } from './move-kinds.js';
import type { BattleEvent, BattleState } from './state.js';

// Steady and Big moves (#587, owner decision 2026-10-19).

const kindRules = BATTLE_RULES.moveKinds!;
const content = createBattleContent(FIXTURE_BATTLE_DATA, {
  ...FIXTURE_BATTLE_RULES,
  moveKinds: kindRules,
});
const DRIZZLE = 'fixture-giggle-drizzle'; // 40 power, 100%: steady for puddlepuff
const FLOP = 'fixture-belly-flop'; // 60 power, 90%: big for puddlepuff
const PUFF = 'fixture-pebble-puff'; // pebblesnooze's only attack: big

const moveOf = (id: string): BattleChoice => ({ type: 'move', move: id });
const turn = (choices: Partial<Record<'a' | 'b', BattleChoice>>): BattleAction => ({
  type: 'turn',
  choices,
});
const eventsOf = (state: BattleState, from: number) => state.log.slice(from);
const hitOn = (events: readonly BattleEvent[], side: 'a' | 'b') =>
  events.find(
    (e): e is Extract<BattleEvent, { type: 'hit' }> => e.type === 'hit' && e.side === side,
  );

/** A player puddlepuff (a) against a player pebblesnooze (b): no AI rolls. */
const duel = (seed = 'duel', gentle = false) => {
  const setup = battleSetup(
    seed,
    { squishies: [squishy('fixture-puddlepuff')] },
    { squishies: [squishy('fixture-pebblesnooze')] },
  );
  return startBattle(content, gentle ? { ...setup, gentle: true } : setup);
};

/** A player puddlepuff (a) against a wild AI puddlepuff (b). */
const wild = (seed: string, gentle = true) => {
  const setup = battleSetup(
    seed,
    { squishies: [squishy('fixture-puddlepuff', { level: 30 })] },
    { controller: ai('wild'), squishies: [squishy('fixture-puddlepuff', { level: 5 })] },
  );
  return startBattle(content, gentle ? { ...setup, gentle: true } : setup);
};

describe('sorting moves into kinds', () => {
  const moves = content.moves;

  it('makes the lowest-power attack steady and the rest big', () => {
    expect(moveKindOf(content, 'fixture-puddlepuff', DRIZZLE)).toBe('steady');
    expect(moveKindOf(content, 'fixture-puddlepuff', FLOP)).toBe('big');
  });

  it('makes a lone attack big, and gives moves with no power no kind', () => {
    expect(moveKindOf(content, 'fixture-pebblesnooze', PUFF)).toBe('big');
    expect(moveKindOf(content, 'fixture-pebblesnooze', 'fixture-rock-a-bye')).toBeUndefined();
  });

  it('breaks a power tie by accuracy, then by list order, and applies overrides', () => {
    const at = (id: string, power: number, accuracy: number): Move => ({
      id,
      name: id,
      description: id,
      element: 'water',
      power,
      accuracy,
    });
    const tie = new Map([
      ['sure', at('sure', 80, 95)],
      ['wild', at('wild', 80, 85)],
      ['also', at('also', 80, 95)],
    ]);
    const s = { id: 'tie', moves: ['wild', 'sure', 'also'] };
    expect(Object.fromEntries(speciesMoveKinds(s, tie, { overrides: {} }))).toEqual({
      wild: 'big',
      sure: 'steady',
      also: 'big',
    });
    const fixed = speciesMoveKinds(s, tie, { overrides: { tie: { sure: 'big', wild: 'steady' } } });
    expect(Object.fromEntries(fixed)).toEqual({ wild: 'steady', sure: 'big', also: 'big' });
  });

  it('reports a species with no big or no steady move, and stray overrides', () => {
    const species = [{ id: 'fixture-puddlepuff', moves: [DRIZZLE, FLOP] }];
    expect(moveKindProblems(species, moves, { overrides: {} })).toEqual([]);
    expect(
      moveKindProblems(species, moves, { overrides: { 'fixture-puddlepuff': { FLOP: 'steady' } } }),
    ).toEqual(['overrides: fixture-puddlepuff has no damaging move "FLOP"']);
    expect(
      moveKindProblems(species, moves, {
        overrides: { 'fixture-puddlepuff': { [FLOP]: 'steady' } },
      }),
    ).toEqual(['fixture-puddlepuff: needs a big move']);
    expect(
      moveKindProblems(species, moves, {
        overrides: { 'fixture-puddlepuff': { [DRIZZLE]: 'big' } },
      }),
    ).toEqual(['fixture-puddlepuff: needs a steady move']);
    expect(moveKindProblems(species, moves, { overrides: { nobody: {} } })).toEqual([
      'overrides: unknown species "nobody"',
    ]);
  });

  it('gives every real species a big move, and one of each with two or more attacks', () => {
    const data = serverBattleData(GAME_DATA, SERVER_GAME_DATA);
    const real = new Map(data.moves.map((m) => [m.id, m]));
    expect(moveKindProblems(data.species, real, kindRules)).toEqual([]);
  });

  it('changes the content hash, and leaves rules without moveKinds as they were', () => {
    expect(content.contentHash).not.toBe(FIXTURE_BATTLE_CONTENT.contentHash);
    expect(FIXTURE_BATTLE_CONTENT.moveKinds.size).toBe(0);
    const overridden = createBattleContent(FIXTURE_BATTLE_DATA, {
      ...FIXTURE_BATTLE_RULES,
      moveKinds: {
        ...kindRules,
        overrides: { 'fixture-puddlepuff': { [DRIZZLE]: 'big', [FLOP]: 'steady' } },
      },
    });
    expect(overridden.contentHash).not.toBe(content.contentHash);
  });
});

describe('stances', () => {
  it('a steady move raises its user’s guard; a big one leaves it open', () => {
    const start = duel();
    const after = applyBattleAction(
      content,
      start,
      turn({ a: moveOf(DRIZZLE), b: moveOf('fixture-rock-a-bye') }),
    );
    expect(eventsOf(after, 0)).toContainEqual({
      turn: 1,
      side: 'a',
      slot: 0,
      type: 'stance',
      stance: 'guard',
    });
    expect(after.sides.a.squishies[0]?.guard).toBe(kindRules.guardPercent);
    // Rock-a-Bye has no power, so it has no kind and no stance.
    expect(after.sides.b.squishies[0]?.guard).toBeUndefined();

    const big = applyBattleAction(
      content,
      after,
      turn({ a: moveOf(FLOP), b: moveOf('fixture-rock-a-bye') }),
    );
    expect(big.sides.a.squishies[0]?.guard).toBe(-kindRules.openPercent);
  });

  it('a guard takes guardPercent off the next hit, an opening adds openPercent, then each is used up', () => {
    const start = duel('stance-maths');
    const plain = applyBattleAction(content, start, turn({ a: moveOf(DRIZZLE), b: moveOf(PUFF) }));
    const base = hitOn(eventsOf(plain, 0), 'b')!;
    const guarded = applyBattleAction(
      content,
      patchActive(start, 'b', { guard: 25 }),
      turn({ a: moveOf(DRIZZLE), b: moveOf(PUFF) }),
    );
    const opened = applyBattleAction(
      content,
      patchActive(start, 'b', { guard: -25 }),
      turn({ a: moveOf(DRIZZLE), b: moveOf(PUFF) }),
    );
    const g = hitOn(eventsOf(guarded, 0), 'b')!;
    const o = hitOn(eventsOf(opened, 0), 'b')!;
    expect(g).toMatchObject({
      amount: Math.max(1, Math.floor((base.amount * 75) / 100)),
      guarded: true,
    });
    expect(o).toMatchObject({ amount: Math.floor((base.amount * 125) / 100), opened: true });
    expect(base.guarded).toBeUndefined();
    // b's own Pebble Puff (big) then leaves it open, replacing the used-up guard.
    expect(guarded.sides.b.squishies[0]?.guard).toBe(-kindRules.openPercent);
  });

  it('a stance comes with a miss too, and a miss into it leaves it standing', () => {
    // Find a seed where Belly Flop (90%) misses.
    for (let i = 0; i < 200; i++) {
      const start = patchActive(duel(`miss-${i}`), 'b', { guard: 25 });
      const after = applyBattleAction(
        content,
        start,
        turn({ a: moveOf(FLOP), b: moveOf('fixture-rock-a-bye') }),
      );
      if (!after.log.some((e) => e.type === 'miss' && e.side === 'a')) continue;
      expect(after.sides.a.squishies[0]?.guard).toBe(-kindRules.openPercent);
      expect(after.sides.b.squishies[0]?.guard).toBe(25);
      return;
    }
    throw new Error('no miss in 200 seeds');
  });

  it('a swap drops the stance', () => {
    const setup = battleSetup(
      'swap',
      { squishies: [squishy('fixture-puddlepuff'), squishy('fixture-splashmallow')] },
      { squishies: [squishy('fixture-pebblesnooze')] },
    );
    const start = patchActive(startBattle(content, setup), 'a', { guard: 25 });
    const after = applyBattleAction(
      content,
      start,
      turn({ a: { type: 'swap', slot: 1 }, b: moveOf('fixture-rock-a-bye') }),
    );
    expect(after.sides.a.squishies[0]?.guard).toBeUndefined();
  });

  it('rules without moveKinds play no stances (battles before #587)', () => {
    const setup = battleSetup(
      'old',
      { squishies: [squishy('fixture-puddlepuff')] },
      { squishies: [squishy('fixture-pebblesnooze')] },
    );
    const after = replayBattle(FIXTURE_BATTLE_CONTENT, { ...setup, gentle: true }, [
      turn({ a: moveOf(DRIZZLE), b: moveOf(PUFF) }),
      turn({ a: moveOf(FLOP), b: moveOf(PUFF) }),
    ]);
    expect(after.log.some((e) => e.type === 'stance')).toBe(false);
    expect(after.sides.a.squishies[0]).not.toHaveProperty('guard');
  });
});

describe('gentle steady moves', () => {
  it('stop at a sliver of a wild squishy’s energy, then do nothing', () => {
    // A strong player against a weak wild squishy: Giggle Drizzle would tucker it out.
    let state = patchActive(wild('gentle'), 'b', { energy: 4 });
    state = applyBattleAction(content, state, turn({ a: moveOf(DRIZZLE) }));
    const first = hitOn(eventsOf(state, 0), 'b');
    expect(first).toMatchObject({ amount: 3, energy: 1, gentle: true });
    expect(state.phase.type).toBe('turn');
    const from = state.log.length;
    state = applyBattleAction(content, state, turn({ a: moveOf(DRIZZLE) }));
    expect(hitOn(eventsOf(state, from), 'b')).toMatchObject({ amount: 0, energy: 1, gentle: true });
    expect(state.sides.b.squishies[0]?.energy).toBe(kindRules.gentleFloor);
  });

  it('a big move still tuckers it out', () => {
    for (let i = 0; i < 50; i++) {
      const state = applyBattleAction(
        content,
        patchActive(wild(`big-${i}`), 'b', { energy: 4 }),
        turn({ a: moveOf(FLOP) }),
      );
      if (state.log.some((e) => e.type === 'miss' && e.side === 'a')) continue;
      expect(state.log.some((e) => e.type === 'tuckered-out' && e.side === 'b')).toBe(true);
      return;
    }
    throw new Error('Belly Flop never landed');
  });

  it('only in a gentle battle: without the flag, a steady move tuckers out', () => {
    const state = applyBattleAction(
      content,
      patchActive(wild('rival', false), 'b', { energy: 4 }),
      turn({ a: moveOf(DRIZZLE) }),
    );
    expect(state.log.some((e) => e.type === 'tuckered-out' && e.side === 'b')).toBe(true);
    expect(hitOn(state.log, 'b')?.gentle).toBeUndefined();
  });

  it('never spares the player: an AI’s steady move can tucker out the player’s squishy', () => {
    for (let i = 0; i < 200; i++) {
      const setup = battleSetup(
        `ai-${i}`,
        { controller: ai('wild'), squishies: [squishy('fixture-puddlepuff', { level: 30 })] },
        { squishies: [squishy('fixture-pebblesnooze', { level: 5 })] },
      );
      const start = patchActive(startBattle(content, { ...setup, gentle: true }), 'b', {
        energy: 2,
      });
      const after = applyBattleAction(content, start, turn({ b: moveOf('fixture-rock-a-bye') }));
      const used = after.log.find((e) => e.type === 'move' && e.side === 'a');
      if (used?.type !== 'move' || used.move !== DRIZZLE) continue;
      expect(after.sides.b.squishies[0]?.energy).toBe(0);
      return;
    }
    throw new Error('the AI never picked Giggle Drizzle');
  });

  it('never applies between two players, and shows in the client view', () => {
    const start = patchActive(duel('pvp', true), 'b', { energy: 2 });
    const after = applyBattleAction(
      content,
      start,
      turn({ a: moveOf(DRIZZLE), b: moveOf('fixture-rock-a-bye') }),
    );
    expect(after.sides.b.squishies[0]?.energy).toBe(0);
    expect(clientBattleView(wild('view')).gentle).toBe(true);
    expect(clientBattleView(wild('view', false))).not.toHaveProperty('gentle');
  });

  it('Flurrypup Lv13 vs a wild Thistlepip Lv5 at 4/20: Snowball Toss leaves it 1 for a Heart Charm', () => {
    const real = createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA));
    expect(moveKindOf(real, 'flurrypup', 'snowball-toss')).toBe('steady');
    expect(moveKindOf(real, 'flurrypup', 'frosty-pounce')).toBe('big');
    const setup = battleSetup(
      'owner-screenshot',
      { squishies: [squishy('flurrypup', { level: 13 })] },
      { controller: ai('wild'), squishies: [squishy('thistlepip', { level: 5 })] },
    );
    const start = patchActive(startBattle(real, { ...setup, gentle: true }), 'b', { energy: 4 });
    const after = applyBattleAction(real, start, turn({ a: moveOf('snowball-toss') }));
    expect(after.sides.b.squishies[0]?.energy).toBe(1);
    expect(after.phase.type).toBe('turn');
  });
});

describe('the AI and stances', () => {
  const start = duel('ai');
  const user = start.sides.a.squishies[0]!;
  const target = start.sides.b.squishies[0]!;
  const drizzle = content.moves.get(DRIZZLE)!;
  const flop = content.moves.get(FLOP)!;
  const score = (policy: 'aggressive' | 'defensive', move: Move) =>
    scoreMove(content, content.rules.ai[policy], move, user, target, policy);

  it('Careful values a steady guard more than Bold, and fears a big opening more', () => {
    const plain = (move: Move) =>
      scoreMove(content, content.rules.ai.defensive, move, user, target);
    expect(score('defensive', drizzle)).toBeGreaterThan(plain(drizzle));
    expect(score('defensive', flop)).toBeLessThan(plain(flop));
    const boldGap = score('aggressive', flop) - score('aggressive', drizzle);
    const carefulGap = score('defensive', flop) - score('defensive', drizzle);
    expect(boldGap).toBeGreaterThan(carefulGap);
  });

  it('a big move that should finish the target carries no opening cost', () => {
    const weak = { ...target, energy: 1 };
    const plain = scoreMove(content, content.rules.ai.defensive, flop, user, weak);
    expect(scoreMove(content, content.rules.ai.defensive, flop, user, weak, 'defensive')).toBe(
      plain,
    );
  });

  it('aims at an open foe: an opening raises every damage score', () => {
    const open = { ...target, guard: -25 };
    expect(score('aggressive', flop)).toBeLessThan(
      scoreMove(content, content.rules.ai.aggressive, flop, user, open, 'aggressive'),
    );
  });

  it('AI-vs-AI battles with stances replay exactly', () => {
    const setup = battleSetup(
      'replay',
      { controller: ai('aggressive'), squishies: [squishy('fixture-puddlepuff')] },
      { controller: ai('defensive'), squishies: [squishy('fixture-splashmallow')] },
    );
    const actions: BattleAction[] = [];
    let state = startBattle(content, setup);
    while (state.phase.type !== 'over') {
      const action = turn({});
      actions.push(action);
      state = applyBattleAction(content, state, action);
    }
    expect(state.log.some((e) => e.type === 'stance')).toBe(true);
    expect(JSON.stringify(replayBattle(content, setup, actions))).toBe(JSON.stringify(state));
  });
});
