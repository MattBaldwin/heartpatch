import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  PLAYER,
  squishy,
} from '../../tests/fixtures/battle.js';
import type {
  BattleAction,
  BattleController,
  BattleFenceSetup,
  BattleSetup,
  BattleSquishySetup,
} from '../schemas/battle.js';
import { ClientBattleViewSchema } from '../schemas/battle.js';
import {
  applyBattleAction,
  autoplayBattle,
  clientBattleView,
  legalChoices,
  replayBattle,
  startBattle,
} from './engine.js';
import { BattleRuleError } from './content.js';
import type { BattleState } from './state.js';

// The fence as a battle participant (#203; owner decision 2026-10-07: a real
// turn-based battle, deterministic and replayable, the fence has energy and
// toughness but no attacks).

const fence = (extra: Partial<BattleFenceSetup> = {}): BattleFenceSetup => ({
  id: 'fence',
  fence: 'hedge',
  level: 1,
  element: 'leaf',
  stats: { hp: 70, attack: 1, defense: 14, speed: 1 },
  energy: 70,
  ...extra,
});

function fenceBattle(
  seed: string,
  breaker: BattleSquishySetup,
  wall: BattleFenceSetup = fence(),
  options: { controller?: BattleController; turnLimit?: number } = {},
): BattleSetup {
  const setup = battleSetup(
    seed,
    { controller: options.controller ?? PLAYER, squishies: [breaker] },
    { controller: ai('guardian'), squishies: [] },
  );
  return {
    ...setup,
    sides: { ...setup.sides, b: { controller: ai('guardian'), squishies: [wall] } },
    turnLimit: options.turnLimit ?? 6,
  };
}

/** Plays the breaker's first move every turn until the battle ends. */
function bashUntilOver(state: BattleState): { state: BattleState; actions: BattleAction[] } {
  const actions: BattleAction[] = [];
  while (state.phase.type !== 'over') {
    const move = state.sides.a.squishies[0]!.moves[0]!;
    const action: BattleAction = { type: 'turn', choices: { a: { type: 'move', move } } };
    actions.push(action);
    state = applyBattleAction(content, state, action);
  }
  return { state, actions };
}

const emberbun = (extra: Partial<BattleSquishySetup> = {}) =>
  squishy('fixture-emberbun', { level: 20, ...extra });
const puddlepuff = (extra: Partial<BattleSquishySetup> = {}) =>
  squishy('fixture-puddlepuff', { level: 20, ...extra });

describe('fence battles (#203)', () => {
  it('starts the fence with the energy it has left, and no moves', () => {
    const state = startBattle(content, fenceBattle('f1', emberbun(), fence({ energy: 42 })));
    const wall = state.sides.b.squishies[0]!;
    expect(wall).toMatchObject({ fence: 'hedge', energy: 42, moves: [] });
    expect(wall.stats.hp).toBe(70);
    expect(state.turnLimit).toBe(6);
  });

  it('never moves: every hit is on the fence, and nothing hits the breaker', () => {
    const { state } = bashUntilOver(startBattle(content, fenceBattle('f2', emberbun())));
    const moves = state.log.filter((e) => e.type === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((e) => e.side === 'a')).toBe(true);
    expect(state.log.filter((e) => e.type === 'hit').every((e) => e.side === 'b')).toBe(true);
    expect(state.sides.a.squishies[0]!.energy).toBe(state.sides.a.squishies[0]!.stats.hp);
  });

  it('is broken when its energy runs out: the breaker wins', () => {
    const { state } = bashUntilOver(
      startBattle(content, fenceBattle('f3', emberbun(), fence({ energy: 5 }))),
    );
    expect(state.phase).toMatchObject({
      type: 'over',
      result: { winner: 'a', reason: 'tuckered-out' },
    });
    expect(state.sides.b.squishies[0]!.energy).toBe(0);
  });

  it('holds at the turn limit, keeping the energy it lost', () => {
    const tough = fence({ stats: { hp: 999, attack: 1, defense: 200, speed: 1 }, energy: 999 });
    const { state } = bashUntilOver(startBattle(content, fenceBattle('f4', emberbun(), tough)));
    expect(state.turn).toBe(6);
    expect(state.phase).toMatchObject({
      type: 'over',
      result: { winner: 'b', reason: 'turn-limit' },
    });
    const left = state.sides.b.squishies[0]!.energy;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(999);
  });

  it('cracks faster for the element its material is weak to (Fire into wood)', () => {
    const hits = (breaker: BattleSquishySetup) => {
      const state = startBattle(content, fenceBattle('f5', breaker));
      const move = state.sides.a.squishies[0]!.moves[0]!;
      const next = applyBattleAction(content, state, {
        type: 'turn',
        choices: { a: { type: 'move', move } },
      });
      const hit = next.log.find((e) => e.type === 'hit');
      if (hit?.type !== 'hit') throw new Error('expected a hit');
      return hit;
    };
    const fire = hits(emberbun());
    const water = hits(puddlepuff());
    expect(fire.effectiveness).toBe('super');
    expect(water.effectiveness).toBe('weak');
    expect(fire.amount).toBeGreaterThan(water.amount);
  });

  it('ignores the breaker’s feeling: only the material’s element counts', () => {
    // Joy and Silly have the same Fire synergy but differ against a Sleepy
    // squishy (the feeling a fence's state carries): a fence shrugs that off.
    const first = (feeling: 'joy' | 'silly') => {
      const state = startBattle(content, fenceBattle('f6', emberbun({ feeling })));
      const move = state.sides.a.squishies[0]!.moves[0]!;
      return applyBattleAction(content, state, {
        type: 'turn',
        choices: { a: { type: 'move', move } },
      }).log.find((e) => e.type === 'hit');
    };
    expect(first('joy')).toEqual(first('silly'));
  });

  it('can’t be befriended, and offers no choices of its own', () => {
    const state = startBattle(content, fenceBattle('f7', emberbun()));
    expect(legalChoices(state, 'a').some((c) => c.type === 'capture')).toBe(false);
    expect(legalChoices(state, 'b')).toEqual([]);
    expect(() =>
      applyBattleAction(content, state, { type: 'turn', choices: { a: { type: 'capture' } } }),
    ).toThrow(BattleRuleError);
  });

  it('stands alone on an AI side', () => {
    const withFriend = fenceBattle('f8', emberbun());
    const crowded: BattleSetup = {
      ...withFriend,
      sides: {
        ...withFriend.sides,
        b: { controller: ai('guardian'), squishies: [fence(), squishy('fixture-pebblesnooze')] },
      },
    };
    expect(() => startBattle(content, crowded)).toThrow(BattleRuleError);
    const played: BattleSetup = {
      ...withFriend,
      sides: { ...withFriend.sides, b: { controller: PLAYER, squishies: [fence()] } },
    };
    expect(() => startBattle(content, played)).toThrow(BattleRuleError);
    expect(() =>
      startBattle(content, fenceBattle('f9', emberbun(), fence({ energy: 71 }))),
    ).toThrow(BattleRuleError);
  });

  it('sends the turn limit to the client, never the RNG', () => {
    const state = startBattle(content, fenceBattle('f10', emberbun()));
    const view = ClientBattleViewSchema.parse(clientBattleView(state));
    expect(view.turnLimit).toBe(6);
    expect(view.sides.b.squishies[0]!.fence).toBe('hedge');
    expect('rng' in view).toBe(false);
  });

  it('replays exactly from its seed and actions, as JSON too', () => {
    const breakers = [emberbun(), puddlepuff(), squishy('fixture-twirlysprout', { level: 12 })];
    for (let i = 0; i < 60; i++) {
      const breaker = breakers[i % breakers.length]!;
      const setup = fenceBattle(`replay-${String(i)}`, breaker, fence({ energy: 10 + i }), {
        controller: ai('aggressive'),
      });
      const { state, actions } = autoplayBattle(content, setup);
      expect(state.phase.type).toBe('over');
      expect(state.turn).toBeLessThanOrEqual(6);
      expect(replayBattle(content, setup, actions)).toEqual(state);
      const stored = JSON.parse(JSON.stringify({ setup, actions })) as {
        setup: BattleSetup;
        actions: BattleAction[];
      };
      expect(replayBattle(content, stored.setup, stored.actions)).toEqual(state);
    }
  });
});
