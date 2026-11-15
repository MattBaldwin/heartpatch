import { describe, expect, it } from 'vitest';
import { ai } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_TEAM_CONTENT as content,
  member,
  teamSetup,
} from '../../tests/fixtures/team-battle.js';
import { hashString } from '../rng/index.js';
import { autoplayBattle, battleRecord, clientBattleView, replayBattleRecord } from './engine.js';

// The team format's own bytes (#190): a balanced team of three against a
// boss, both sides AI-played, pinned when the team path was written. Any
// later engine change that alters a team battle shows here.
describe('the golden team battle is pinned byte for byte (#190)', () => {
  it('keeps the stored state and client view, and replays from its record', () => {
    const setup = teamSetup(
      'golden-team',
      [
        member(0, 'fixture-emberbun'),
        member(1, 'fixture-puddlepuff'),
        member(2, 'fixture-twirlysprout', { level: 18 }),
      ],
      { level: 22 },
      ai('balanced'),
    );
    const { state, actions } = autoplayBattle(content, setup);
    expect(state.phase.type).toBe('over');
    const stored = JSON.stringify(state);
    expect({
      state: hashString(stored),
      view: hashString(JSON.stringify(clientBattleView(state))),
      turns: state.turn,
    }).toMatchInlineSnapshot(`
      {
        "state": "285659ae4a9507a507919168c6a44b73",
        "turns": 7,
        "view": "03a033cb8eef14a0277e4c621383950d",
      }
    `);
    const record = battleRecord(setup, actions, state);
    expect(JSON.stringify(replayBattleRecord(content, record))).toBe(stored);
  });
});
