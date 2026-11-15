import { describe, expect, it } from 'vitest';
import { ai, battleSetup, squishy } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_FLAT_TEAM_CONTENT as content,
  FIXTURE_SPARK_SHOWER as shower,
  member,
  sturdy,
  teamSetup,
} from '../../tests/fixtures/team-battle.js';
import { applyBattleAction, startBattle } from './engine.js';
import { damageBeforeVariance } from './formulas.js';
import type { BattleState } from './state.js';

// Fixture content with no damage variance, so each hit's size is exact.
const full = (state: BattleState, from: 'a' | 'b', slot: number, target: number) =>
  Math.floor(
    damageBeforeVariance(
      content,
      shower,
      state.sides[from].squishies[slot]!,
      state.sides[from === 'a' ? 'b' : 'a'].squishies[target]!,
    ),
  );

describe('area moves (#190)', () => {
  it('roll accuracy and damage per foe, in slot order, at spreadPercent', () => {
    let hits = 0;
    let misses = 0;
    for (let i = 0; i < 20; i++) {
      const setup = teamSetup(
        `spread-${i}`,
        [0, 1, 2].map((slot) => member(slot, 'fixture-bonkbun', { stats: sturdy(10 + slot) })),
        { speciesId: 'fixture-sparkbun' },
      );
      const state = startBattle(content, setup);
      const next = applyBattleAction(content, state, {
        type: 'turn',
        choices: {
          a: { type: 'team', picks: [0, 1, 2].map((slot) => ({ slot, move: 'fixture-bonk' })) },
        },
      });
      // The boss is fastest: its first action opens the round.
      const first = next.log.findIndex((e) => e.type === 'move' && e.side === 'b');
      const end = next.log.findIndex((e, at) => at > first && e.type === 'move');
      const rolls = next.log
        .slice(first + 1, end)
        .filter((e) => e.type === 'hit' || e.type === 'miss');
      expect(rolls).toHaveLength(3);
      const hitSlots = rolls.flatMap((e) => (e.type === 'hit' ? [e.slot] : []));
      expect(hitSlots).toEqual([...hitSlots].sort());
      for (const e of rolls) {
        if (e.type === 'miss') {
          misses += 1;
          continue;
        }
        hits += 1;
        expect(e.side).toBe('a');
        const want = Math.max(1, Math.floor((full(state, 'b', 0, e.slot) * 60) / 100));
        expect(e.amount).toBe(want);
      }
    }
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });

  it('hits a lone foe at full power, in a team battle and one-on-one', () => {
    const team = startBattle(
      content,
      teamSetup('lone', [member(0, 'fixture-sparkbun', { stats: sturdy(999) })]),
    );
    const next = applyBattleAction(content, team, {
      type: 'turn',
      choices: { a: { type: 'team', picks: [{ slot: 0, move: shower.id }] } },
    });
    const hit = next.log.find((e) => e.type === 'hit' && e.side === 'b');
    expect(hit?.type === 'hit' && hit.amount).toBe(full(team, 'a', 0, 0));

    const setup = battleSetup(
      'one-on-one',
      { squishies: [squishy('fixture-sparkbun', { stats: sturdy(999) })] },
      { controller: ai('wild'), squishies: [squishy('fixture-bonkbun', { stats: sturdy(1) })] },
    );
    const single = startBattle(content, setup);
    const after = applyBattleAction(content, single, {
      type: 'turn',
      choices: { a: { type: 'move', move: shower.id } },
    });
    const one = after.log.find((e) => e.type === 'hit' && e.side === 'b');
    expect(one?.type === 'hit' && one.amount).toBe(full(single, 'a', 0, 0));
  });
});
