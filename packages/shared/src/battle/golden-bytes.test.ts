import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  squishy,
} from '../../tests/fixtures/battle.js';
import { hashString } from '../rng/index.js';
import { autoplayBattle, clientBattleView, replayBattle } from './engine.js';

// #203 added a fence participant and an optional `turnLimit` to the reducer.
// Battles without either must serialize to exactly the same bytes as before
// (stored battles replay unchanged): this hash of the golden battle's whole
// final state and client view was taken on main before #203.
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
    expect(hashString(stored)).toBe('5e2f28edf585d65457347109fb2a2717');
    expect(hashString(JSON.stringify(clientBattleView(state)))).toBe(
      '9f4340a183e1a351f373655a5057a71c',
    );
    expect(JSON.stringify(replayBattle(content, setup, actions))).toBe(stored);
    expect(stored).not.toMatch(/turnLimit|"fence"/);
  });
});
