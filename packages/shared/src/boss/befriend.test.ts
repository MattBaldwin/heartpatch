import { describe, expect, it } from 'vitest';
import { BOSS_EVENTS } from '../data/server/boss-events.js';
import { BossEventRulesSchema } from '../schemas/data/boss-events.js';
import { baseFormOf, bossBefriendChance, bossBefriendRoll, bossJoinLevel } from './befriend.js';

const rules = BOSS_EVENTS.befriend;

describe('mini-boss befriending (#190 plan §3)', () => {
  it('ships valid rules with the owner-approved numbers', () => {
    expect(BossEventRulesSchema.safeParse(BOSS_EVENTS).success).toBe(true);
    expect(rules).toMatchObject({ charmsPerAsk: 3, asksPerWin: 2, sureAfterMisses: 4 });
  });

  it('starts at the base, adds per squishy standing and per earlier miss', () => {
    expect(bossBefriendChance(rules, 0, 0)).toBe(20);
    expect(bossBefriendChance(rules, 3, 0)).toBe(35);
    expect(bossBefriendChance(rules, 3, 1)).toBe(50);
    expect(bossBefriendChance(rules, 3, 3)).toBe(80);
  });

  it('always works after enough misses, and never goes over 100', () => {
    expect(bossBefriendChance(rules, 0, 4)).toBe(100);
    expect(bossBefriendChance({ ...rules, basePercent: 90 }, 6, 3)).toBe(100);
  });

  it('rolls the same for the same battle, patch and ask, and differently per ask', () => {
    const seed = 'battle-seed-1';
    expect(bossBefriendRoll(seed, 'patch', 1)).toBe(bossBefriendRoll(seed, 'patch', 1));
    const patches = new Set(
      Array.from({ length: 20 }, (_, i) => bossBefriendRoll(seed, `patch-${String(i)}`, 1)),
    );
    expect(patches.size).toBeGreaterThan(1);
    const rolls = new Set(
      Array.from({ length: 20 }, (_, i) => bossBefriendRoll(seed, 'patch', i + 1)),
    );
    expect(rolls.size).toBeGreaterThan(1);
    for (const roll of rolls) {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(100);
    }
  });

  it('finds the base form back through every evolution', () => {
    const steps = [
      { from: 'tiny', into: 'middle', level: 10 },
      { from: 'middle', into: 'boss', level: 30 },
    ];
    expect(baseFormOf('boss', steps)).toBe('tiny');
    expect(baseFormOf('middle', steps)).toBe('tiny');
    expect(baseFormOf('tiny', steps)).toBe('tiny');
    expect(baseFormOf('alone', steps)).toBe('alone');
  });

  it('joins at half the Partner level, at least 5', () => {
    expect(bossJoinLevel(rules, 30)).toBe(15);
    expect(bossJoinLevel(rules, 31)).toBe(15);
    expect(bossJoinLevel(rules, 6)).toBe(5);
  });
});
