import { describe, expect, it } from 'vitest';
import {
  FIXTURE_TEAM_CONTENT as content,
  member,
  sturdy,
  teamSetup,
} from '../../tests/fixtures/team-battle.js';
import { Rng } from '../rng/index.js';
import { chooseTarget, chooseTeamMove, standingOut } from './ai.js';
import { getMove } from './content.js';
import { applyBattleAction, startBattle } from './engine.js';
import type { BattleSquishy } from './state.js';

const bonk = getMove(content, 'fixture-bonk');
const state = startBattle(
  content,
  teamSetup(
    'targets',
    [0, 1, 2].map((slot) => member(slot, 'fixture-bonkbun', { stats: sturdy(20) })),
  ),
);
const boss = state.sides.b.squishies[0]!;
const foes = standingOut(state, 'a');

/** How often each slot is picked over `n` seeded draws. */
function shares(list: { slot: number; squishy: BattleSquishy }[], hit: Set<number>, n = 4000) {
  const rng = Rng.fromSeed('shares');
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const slot = chooseTarget(content, bonk, boss, list, hit, rng);
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return list.map(({ slot }) => (counts.get(slot) ?? 0) / n);
}

describe('the boss picks its targets (#190)', () => {
  it('spreads its hits: a foe it already hit this round weighs 25%', () => {
    const [a, b, c] = shares(foes, new Set([0]));
    // Weights 0.25 : 1 : 1.
    expect(a).toBeGreaterThan(0.08);
    expect(a).toBeLessThan(0.14);
    expect(b).toBeGreaterThan(0.38);
    expect(c).toBeGreaterThan(0.38);
  });

  it('leans toward a foe with less energy left', () => {
    const tired = foes.map((f, i) =>
      i === 2 ? { ...f, squishy: { ...f.squishy, energy: f.squishy.stats.hp / 2 } } : f,
    );
    const [a, , c] = shares(tired, new Set());
    // Weights 1 : 1 : 1.5.
    expect(c).toBeGreaterThan(a! * 1.3);
  });

  it('is seeded: the same RNG state picks the same move and target', () => {
    const pick = () =>
      chooseTeamMove(
        content,
        state,
        'b',
        0,
        content.rules.boss!.ai,
        new Set([1]),
        Rng.fromSeed('same'),
      );
    expect(pick()).toEqual(pick());
    // One foe: no target roll at all.
    const rng = Rng.fromSeed('one');
    const before = rng.state();
    expect(chooseTarget(content, bonk, boss, foes.slice(0, 1), new Set(), rng)).toBe(0);
    expect(rng.state()).toEqual(before);
  });

  it('rarely hits the same squishy twice in one round', () => {
    let rounds = 0;
    let twice = 0;
    for (let i = 0; i < 300; i++) {
      const s = startBattle(content, {
        ...teamSetup(
          `twice-${i}`,
          [0, 1, 2].map((slot) => member(slot, 'fixture-bonkbun', { stats: sturdy(5) })),
        ),
      });
      const next = applyBattleAction(content, s, {
        type: 'turn',
        choices: {
          a: { type: 'team', picks: [0, 1, 2].map((slot) => ({ slot, move: 'fixture-bonk' })) },
        },
      });
      // The boss's hits: `hit` events on side a.
      const hits = next.log.flatMap((e) => (e.type === 'hit' && e.side === 'a' ? [e.slot] : []));
      if (hits.length !== 2) continue;
      rounds += 1;
      if (hits[0] === hits[1]) twice += 1;
    }
    expect(rounds).toBeGreaterThan(100);
    // 0.25 / 2.25 ≈ 11% when it picks the one-foe move both times.
    expect(twice / rounds).toBeLessThan(0.2);
  });
});
