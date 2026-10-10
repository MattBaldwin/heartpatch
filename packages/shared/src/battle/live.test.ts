import { describe, expect, it } from 'vitest';
import {
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  patchActive,
  squishy,
} from '../../tests/fixtures/battle.js';
import { LIVE_BATTLE_RULES } from '../data/live-battles.js';
import type { BattleAction } from '../schemas/battle.js';
import { LiveBattleRulesSchema } from '../schemas/data/live-battles.js';
import { BattleRuleError } from './content.js';
import { applyBattleAction, replayBattle, startBattle } from './engine.js';
import { coverChoice, coverReplacement, liveTurnAction, sidesToAct } from './live.js';
import type { BattleState } from './state.js';

const SEED = 'live-seed';

/** Both sides are players: a friendly battle (#29). */
const live = (): BattleState =>
  startBattle(
    content,
    battleSetup(
      SEED,
      { squishies: [squishy('fixture-emberbun'), squishy('fixture-twirlysprout')] },
      { squishies: [squishy('fixture-twirlysprout'), squishy('fixture-emberbun')] },
    ),
  );

describe('live turns (#29)', () => {
  it('ships valid live-battle rules', () => {
    expect(LiveBattleRulesSchema.parse(LIVE_BATTLE_RULES)).toEqual(LIVE_BATTLE_RULES);
  });

  it('both player sides owe a pick in the turn phase', () => {
    expect(sidesToAct(live())).toEqual(['a', 'b']);
  });

  it('waits until every side has picked, then builds one turn action', () => {
    const state = live();
    const move = { type: 'move', move: 'fixture-tickle-tackle' } as const;
    expect(liveTurnAction(state, { a: move })).toBeNull();
    expect(liveTurnAction(state, { a: move, b: move })).toEqual({
      type: 'turn',
      choices: { a: move, b: move },
    });
  });

  it('refuses a pick for a side that owes nothing', () => {
    const state = startBattle(
      content,
      battleSetup(
        SEED,
        { squishies: [squishy('fixture-emberbun')] },
        {
          controller: { type: 'ai', policy: 'balanced' },
          squishies: [squishy('fixture-twirlysprout')],
        },
      ),
    );
    expect(sidesToAct(state)).toEqual(['a']);
    expect(() =>
      liveTurnAction(state, { b: { type: 'move', move: 'fixture-tickle-tackle' } }),
    ).toThrow(BattleRuleError);
  });

  it('a covered pick is a legal choice and the same for the same battle and turn', () => {
    const state = live();
    const before = structuredClone(state);
    const one = coverChoice(content, state, 'b', 'balanced', SEED);
    expect(state).toEqual(before);
    const two = coverChoice(content, state, 'b', 'balanced', SEED);
    expect(one).toEqual(two);
    const action = liveTurnAction(state, {
      a: { type: 'move', move: 'fixture-tickle-tackle' },
      b: one,
    });
    expect(action).not.toBeNull();
    expect(() => applyBattleAction(content, state, action!)).not.toThrow();
  });

  it('covering a turn leaves the battle RNG alone, so the record replays', () => {
    const setup = battleSetup(
      SEED,
      { squishies: [squishy('fixture-emberbun')] },
      { squishies: [squishy('fixture-twirlysprout')] },
    );
    let state = startBattle(content, setup);
    const actions: BattleAction[] = [];
    while (state.phase.type !== 'over' && actions.length < 200) {
      const action =
        state.phase.type === 'replace'
          ? coverReplacement(content, state, state.phase.sides[0]!, 'balanced', SEED)
          : liveTurnAction(state, {
              a: coverChoice(content, state, 'a', 'aggressive', SEED),
              b: coverChoice(content, state, 'b', 'defensive', SEED),
            })!;
      actions.push(action);
      state = applyBattleAction(content, state, action);
    }
    expect(state.phase.type).toBe('over');
    expect(replayBattle(content, setup, actions)).toEqual(state);
  });

  it('a timed-out replacement sends out someone still in the fight', () => {
    let state = live();
    state = patchActive(state, 'b', { energy: 1 });
    // Side a hits until b's first squishy is tuckered out.
    for (let i = 0; i < 20 && state.phase.type === 'turn'; i++) {
      state = applyBattleAction(content, state, {
        type: 'turn',
        choices: {
          a: { type: 'move', move: 'fixture-tickle-tackle' },
          b: { type: 'move', move: 'fixture-silly-face' },
        },
      });
    }
    expect(state.phase).toEqual({ type: 'replace', sides: ['b'] });
    expect(sidesToAct(state)).toEqual(['b']);
    const action = coverReplacement(content, state, 'b', 'balanced', SEED);
    expect(action).toEqual({ type: 'replace', side: 'b', slot: 1 });
    expect(applyBattleAction(content, state, action).phase).toEqual({ type: 'turn' });
  });

  it('refuses to cover a side with nothing to do', () => {
    const state = live();
    expect(() => coverReplacement(content, state, 'a', 'balanced', SEED)).toThrow(BattleRuleError);
  });
});
