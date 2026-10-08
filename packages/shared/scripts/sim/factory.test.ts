import { describe, expect, it } from 'vitest';
import { FACTORY_CONFIG } from './factory-config.js';
import {
  covers,
  factoryLevelCosts,
  firstBuildsCost,
  renderFactory,
  runFactory,
} from './factory.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

describe('the Factory model (#294)', () => {
  it('adds the levels up, so each level is everything paid to reach it', () => {
    const [one, two, three] = factoryLevelCosts();
    expect(one).toEqual({ timber: 30, stone: 20 });
    // Level 2 has no Glimmer (owner decision 2026-10-08).
    expect(two).toEqual({ timber: 90, stone: 70 });
    expect(three).toEqual({ timber: 210, stone: 160, glimmer: 12 });
  });

  it('pays for the first home builds at level 1', () => {
    expect(firstBuildsCost(['cozy-meadow', 'ember-den'])).toEqual({ timber: 9, stone: 5 });
    expect(covers({ timber: 9, stone: 5 }, { timber: 9, stone: 5 })).toBe(true);
    expect(covers({ timber: 9 }, { timber: 9, stone: 1 })).toBe(false);
  });
});

describe('runFactory', () => {
  const small = { ...PROGRESSION_CONFIG, estimateGames: 4 };
  const rows = runFactory({ ...FACTORY_CONFIG, days: 10 }, small);

  it('lets a casual kid build level 1 in their first week and level 2 by about day 10, on every map size', () => {
    const casual = rows.filter((r) => r.kid === 'casual');
    expect(casual.map((r) => r.seats)).toEqual([...FACTORY_CONFIG.seats]);
    for (const row of casual) {
      expect(row.levelDays[0]).not.toBeNull();
      expect(row.levelDays[0]).toBeLessThanOrEqual(FACTORY_CONFIG.levelOneByDay);
      expect(row.levelDays[1]).not.toBeNull();
      expect(row.levelDays[1]).toBeLessThanOrEqual(FACTORY_CONFIG.levelTwoByDay);
    }
  });

  it('never opens a level before the one below it, and reports every kid', () => {
    for (const row of rows) {
      const days = row.levelDays.map((d) => d ?? Infinity);
      expect([...days].sort((a, b) => a - b)).toEqual(days);
    }
    expect(renderFactory(rows, FACTORY_CONFIG, { seconds: 0 })).toContain('| 2 | casual |');
  });
});
