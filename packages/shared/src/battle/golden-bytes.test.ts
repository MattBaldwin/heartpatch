import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  squishy,
} from '../../tests/fixtures/battle.js';
import { hashString } from '../rng/index.js';
import type { BattleAction } from '../schemas/battle.js';
import {
  applyBattleAction,
  autoplayBattle,
  clientBattleView,
  replayBattle,
  startBattle,
} from './engine.js';

// #203 added a fence participant and an optional `turnLimit` to the reducer.
// Battles without either must serialize to exactly the same bytes as before
// (stored battles replay unchanged): this hash of the golden battle's whole
// final state and client view is taken on main without #203's engine change
// (retaken at 48b08a5, after #261 added Mythic to the battle rules' content hash).
describe('squishy battles are byte-identical after the fence participant (#203)', () => {
  it('keeps the golden battle’s stored state and client view byte for byte', () => {
    const setup = battleSetup(
      'golden',
      {
        controller: ai('balanced'),
        squishies: [squishy('fixture-emberbun'), squishy('fixture-puddlepuff', { level: 12 })],
      },
      {
        controller: ai('guardian'),
        squishies: [squishy('fixture-twirlysprout'), squishy('fixture-pebblesnooze')],
      },
    );
    const { state, actions } = autoplayBattle(content, setup);
    const stored = JSON.stringify(state);
    expect(hashString(stored)).toBe('d8da0cce61e3c29731e08c9bac22408a');
    expect(hashString(JSON.stringify(clientBattleView(state)))).toBe(
      'b56ec0339a4c660186a02657657195cb',
    );
    expect(JSON.stringify(replayBattle(content, setup, actions))).toBe(stored);
    expect(stored).not.toMatch(/turnLimit|"fence"/);
  });
});

/** A wild battle the player wins by befriending: Heart Charms until one works. */
function wildBefriend() {
  const setup = battleSetup(
    'golden-befriend',
    { squishies: [squishy('fixture-emberbun'), squishy('fixture-puddlepuff', { level: 12 })] },
    { controller: ai('wild'), squishies: [squishy('fixture-snoozlet')] },
  );
  let state = startBattle(content, setup);
  const actions: BattleAction[] = [];
  const act = (action: BattleAction) => {
    actions.push(action);
    state = applyBattleAction(content, state, action);
  };
  act({ type: 'turn', choices: { a: { type: 'move', move: 'fixture-tickle-tackle' } } });
  for (let i = 0; i < 40 && state.phase.type === 'turn'; i++) {
    act({ type: 'turn', choices: { a: { type: 'capture' } } });
  }
  return { setup, state, actions };
}

// #279 made a befriend count as a knockout: the squishy leaves the fight and
// the battle ends only when nobody is left. A wild battle has one squishy, so
// a befriend still ends it there and then, byte for byte as before. These
// hashes were taken on main before #279's engine change (ea67aad).
describe('wild befriends are byte-identical after "befriend is a knockout" (#279)', () => {
  it('keeps a wild befriend’s stored state and client view byte for byte', () => {
    const { setup, state, actions } = wildBefriend();
    expect(state.phase.type === 'over' && state.phase.result.reason).toBe('captured');
    const stored = JSON.stringify(state);
    expect(hashString(stored)).toBe('c27d21c9a6ccc70d02ddd7ca04898f00');
    expect(hashString(JSON.stringify(clientBattleView(state)))).toBe(
      'd8b1f325d35250ccfecff03c8a0d9366',
    );
    expect(JSON.stringify(replayBattle(content, setup, actions))).toBe(stored);
  });
});

// The new rule's own bytes (#279): two land guardians, the first befriended
// mid-battle (it leaves, the second steps in), then Heart Charms until the
// second says yes. Pinned at #279 so any later engine change that alters a
// guardian befriend shows here.
describe('a guardian befriend mid-battle is pinned byte for byte (#279)', () => {
  it('keeps the two-guardian befriend’s stored state and client view byte for byte', () => {
    const setup = battleSetup(
      'golden-guardians',
      { squishies: [squishy('fixture-emberbun', { level: 20 })] },
      {
        controller: ai('guardian'),
        squishies: [squishy('fixture-snoozlet'), squishy('fixture-twirlysprout')],
      },
    );
    let state = startBattle(content, setup);
    const actions: BattleAction[] = [];
    const act = (action: BattleAction) => {
      actions.push(action);
      state = applyBattleAction(content, state, action);
    };
    act({ type: 'turn', choices: { a: { type: 'capture', sure: true } } });
    for (let i = 0; i < 40 && state.phase.type === 'turn'; i++) {
      act({ type: 'turn', choices: { a: { type: 'capture' } } });
    }
    expect(state.sides.b.squishies[0]).toMatchObject({ befriended: true });
    expect(state.phase.type === 'over' && state.phase.result).toMatchObject({
      winner: 'a',
      reason: 'captured',
    });
    const stored = JSON.stringify(state);
    expect(hashString(stored)).toBe('bad0148a708e5a00c11b3db97d57d91e');
    expect(hashString(JSON.stringify(clientBattleView(state)))).toBe(
      'dd5fc71c68b8f431340078176156c6ad',
    );
    expect(JSON.stringify(replayBattle(content, setup, actions))).toBe(stored);
  });
});
