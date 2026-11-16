import { describe, expect, it } from 'vitest';
import { ai } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_EFFECT_CONTENT as content,
  member,
  teamSetup,
} from '../../tests/fixtures/team-battle.js';
import { hashString } from '../rng/index.js';
import { autoplayBattle, battleRecord, clientBattleView, replayBattleRecord } from './engine.js';

// The #234 move effects' own bytes: a team of three, between them using a
// windup, a flinch, a low-energy hit and an assist, against a boss that
// knows all four, both sides AI-played. Pinned when the effects were
// written; any later engine change that alters them shows here.
describe('the golden effects team battle is pinned byte for byte (#234)', () => {
  const setup = teamSetup(
    'golden-effects-8',
    [
      member(0, 'fixture-counterbun'),
      member(1, 'fixture-shoutbun'),
      member(2, 'fixture-helperbun', { level: 18 }),
    ],
    { speciesId: 'fixture-trickgourd', level: 22 },
    ai('balanced'),
  );
  const { state, actions } = autoplayBattle(content, setup);

  it('uses all four effects and keeps the stored state and client view', () => {
    expect(state.phase.type).toBe('over');
    const types = new Set(state.log.map((e) => e.type));
    for (const type of ['windup', 'flinch', 'assist'] as const) expect(types).toContain(type);
    const moves = new Set(state.log.flatMap((e) => (e.type === 'move' ? [e.move] : [])));
    expect(moves).toContain('fixture-last-stand');
    // The boss's count is wound up one round and lands the next.
    const counts = state.log.filter((e) => e.type === 'move' && e.move === 'fixture-countdown');
    expect(counts.map((e) => e.turn)).toEqual([3, 4]);
    expect({
      state: hashString(JSON.stringify(state)),
      view: hashString(JSON.stringify(clientBattleView(state))),
      turns: state.turn,
    }).toMatchInlineSnapshot(`
      {
        "state": "22e240d6d98fcccf6140640e6cb949b2",
        "turns": 5,
        "view": "caf7974a5984e6f3c846fe4a31b22065",
      }
    `);
  });

  it('replays from its record', () => {
    const record = battleRecord(setup, actions, state);
    expect(JSON.stringify(replayBattleRecord(content, record))).toBe(JSON.stringify(state));
  });
});
