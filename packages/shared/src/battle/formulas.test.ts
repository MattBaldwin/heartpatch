import { describe, expect, it } from 'vitest';
import {
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  squishy,
  FIXTURE_BATTLE_RULES,
} from '../../tests/fixtures/battle.js';
import { ELEMENT_MATRIX, FEELING_MATRIX, SYNERGY_TABLE } from '../data/matrices.js';
import { Rng } from '../rng/index.js';
import { getMove } from './content.js';
import { startBattle } from './engine.js';
import {
  damageBeforeVariance,
  effectivenessTier,
  expectedDamage,
  rollDamage,
  stageMultiplier,
  statsAtLevel,
} from './formulas.js';
import { activeSquishy, type BattleSquishy } from './state.js';

/** A battle squishy as the engine sees it. */
function fighter(speciesId: string, extra: Parameters<typeof squishy>[1] = {}): BattleSquishy {
  const state = startBattle(
    content,
    battleSetup(
      'formulas',
      { squishies: [squishy(speciesId, extra)] },
      { squishies: [squishy('fixture-snoozlet')] },
    ),
  );
  return activeSquishy(state, 'a');
}

describe('statsAtLevel', () => {
  it('scales base stats with level', () => {
    const base = { hp: 50, attack: 55, defense: 40, speed: 60 };
    expect(statsAtLevel(base, 10, FIXTURE_BATTLE_RULES)).toEqual({
      hp: 30,
      attack: 16,
      defense: 13,
      speed: 17,
    });
    expect(statsAtLevel(base, 50, FIXTURE_BATTLE_RULES)).toEqual({
      hp: 110,
      attack: 60,
      defense: 45,
      speed: 65,
    });
  });
});

describe('stageMultiplier', () => {
  it('raises by perStage per stage and lowers by the reciprocal', () => {
    expect(stageMultiplier(0, FIXTURE_BATTLE_RULES)).toBe(1);
    expect(stageMultiplier(2, FIXTURE_BATTLE_RULES)).toBe(2);
    expect(stageMultiplier(-2, FIXTURE_BATTLE_RULES)).toBe(0.5);
  });
});

describe('damage (design doc §6)', () => {
  const tackle = getMove(content, 'fixture-tickle-tackle');

  it('multiplies by the element matrix, from the data', () => {
    const user = fighter('fixture-emberbun');
    const leaf = fighter('fixture-twirlysprout', { feeling: 'cozy' });
    const water = fighter('fixture-twirlysprout', { feeling: 'cozy', element: 'water' });
    const ratio =
      damageBeforeVariance(content, tackle, user, leaf) /
      damageBeforeVariance(content, tackle, user, water);
    expect(ratio).toBeCloseTo(ELEMENT_MATRIX.fire.leaf / ELEMENT_MATRIX.fire.water);
  });

  it('multiplies by the feeling matrix, from the data', () => {
    const user = fighter('fixture-emberbun');
    const joy = fighter('fixture-twirlysprout', { element: 'fire' });
    const silly = fighter('fixture-twirlysprout', { element: 'fire', feeling: 'silly' });
    const ratio =
      damageBeforeVariance(content, tackle, user, joy) /
      damageBeforeVariance(content, tackle, user, silly);
    expect(ratio).toBeCloseTo(FEELING_MATRIX.cozy.joy / FEELING_MATRIX.cozy.silly);
  });

  it("multiplies by the attacker's own synergy, from the data", () => {
    const target = fighter('fixture-twirlysprout');
    const cozy = fighter('fixture-emberbun', { feeling: 'cozy' });
    // Same feeling matchup into joy (1×) so only synergy differs.
    const brave = fighter('fixture-emberbun', { feeling: 'joy' });
    const ratio =
      (damageBeforeVariance(content, tackle, cozy, target) /
        damageBeforeVariance(content, tackle, brave, target)) *
      (FEELING_MATRIX.joy.joy / FEELING_MATRIX.cozy.joy);
    expect(ratio).toBeCloseTo(SYNERGY_TABLE.fire.cozy / SYNERGY_TABLE.fire.joy);
  });

  it('uses the base formula with level, power, attack and defense', () => {
    const user = fighter('fixture-emberbun');
    const target = fighter('fixture-twirlysprout');
    // ((10 / 2.5 + 2) × 70 × 16 / 14) / 50 + 2 = 11.6; × fire→leaf 2 × cozy→joy 1 × fire/cozy 1.2
    expect(damageBeforeVariance(content, tackle, user, target)).toBeCloseTo(11.6 * 2 * 1 * 1.2);
  });

  it('rolls seeded variance between 0.9× and 1.1×', () => {
    const user = fighter('fixture-emberbun');
    const target = fighter('fixture-twirlysprout');
    const raw = damageBeforeVariance(content, tackle, user, target);
    const rng = Rng.fromSeed('variance');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const amount = rollDamage(content, tackle, user, target, rng);
      expect(amount).toBeGreaterThanOrEqual(Math.floor(raw * 0.9));
      expect(amount).toBeLessThanOrEqual(Math.floor(raw * 1.1));
      seen.add(amount);
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(expectedDamage(content, tackle, user, target)).toBeCloseTo(raw);
  });

  it('never does less than the minimum', () => {
    const tiny = { ...tackle, power: 1 };
    const user = fighter('fixture-snoozlet', { level: 1 });
    const wall = fighter('fixture-pebblesnooze', { level: 100 });
    expect(rollDamage(content, tiny, user, wall, Rng.fromSeed('x'))).toBe(1);
    expect(expectedDamage(content, { ...tiny, power: 0 }, user, wall)).toBe(1);
  });
});

describe('effectivenessTier', () => {
  it('picks the first tier the multiplier reaches', () => {
    expect(effectivenessTier(2.5, FIXTURE_BATTLE_RULES)).toBe('super');
    expect(effectivenessTier(1.5, FIXTURE_BATTLE_RULES)).toBe('super');
    expect(effectivenessTier(1.25, FIXTURE_BATTLE_RULES)).toBe('good');
    expect(effectivenessTier(1, FIXTURE_BATTLE_RULES)).toBe('normal');
    expect(effectivenessTier(0.4, FIXTURE_BATTLE_RULES)).toBe('weak');
  });

  it('throws if the rules leave a gap at the bottom', () => {
    const rules = { ...FIXTURE_BATTLE_RULES, effectiveness: [{ id: 'super', atLeast: 1.5 }] };
    expect(() => effectivenessTier(1, rules)).toThrow(/starts at 0/);
  });
});
