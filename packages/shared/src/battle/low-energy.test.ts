import { describe, expect, it } from 'vitest';
import { battleSetup, squishy } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_BONK as bonk,
  FIXTURE_EFFECT_CONTENT as content,
  FIXTURE_LAST_STAND as lastStand,
  sturdy,
} from '../../tests/fixtures/team-battle.js';
import { startBattle } from './engine.js';
import { damageBeforeVariance, expectedDamage, movePower } from './formulas.js';
import type { BattleSquishy } from './state.js';

const state = startBattle(
  content,
  battleSetup(
    'low',
    { squishies: [squishy('fixture-helperbun', { stats: sturdy(50) })] },
    { squishies: [squishy('fixture-bonkbun', { stats: sturdy(50) })] },
  ),
);
const user = state.sides.a.squishies[0]!;
const foe = state.sides.b.squishies[0]!;
const at = (energy: number, extra: Partial<BattleSquishy> = {}): BattleSquishy => ({
  ...user,
  energy,
  ...extra,
});

describe('low-energy power (#234)', () => {
  it('adds nothing at full energy (bit-identical to a plain move)', () => {
    // Last Stand is Bonk (same element, power and accuracy) plus the effect.
    expect(movePower(lastStand, user)).toBe(lastStand.power);
    expect(damageBeforeVariance(content, lastStand, user, foe)).toBe(
      damageBeforeVariance(content, bonk, user, foe),
    );
    // A move without the effect never changes, whatever the energy.
    expect(movePower(bonk, at(1))).toBe(bonk.power);
  });

  it('scales power by energy lost, floored, with potions and stages on top', () => {
    expect(movePower(lastStand, at(250))).toBe(60); // half lost: +50% of 40
    expect(movePower(lastStand, at(1))).toBe(79); // 40 + floor(40 × 499/500)
    expect(movePower(lastStand, { energy: 2, stats: { hp: 7 } })).toBe(68); // 40 + floor(28.57)
    const sixty = { ...bonk, power: 60 };
    const brave = at(250, {
      stages: { attack: 2, defense: 0, speed: 0 },
      boosts: { attack: 25, defense: 0 },
    });
    expect(damageBeforeVariance(content, lastStand, brave, foe)).toBe(
      damageBeforeVariance(content, sixty, brave, foe),
    );
  });

  it('expectedDamage counts it', () => {
    const sixty = { ...bonk, power: 60 };
    expect(expectedDamage(content, lastStand, at(250), foe)).toBe(
      expectedDamage(content, sixty, at(250), foe),
    );
    expect(expectedDamage(content, lastStand, at(250), foe)).toBeGreaterThan(
      expectedDamage(content, lastStand, user, foe),
    );
  });
});
