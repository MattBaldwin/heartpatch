import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../../src/data/communities.js';
import { HOLLOWED_CONFIG } from './hollowed-config.js';
import {
  daysToRestore,
  heartdustPerSearch,
  hollowedDustPerSearch,
  renderHollowed,
  runHollowed,
  villageCost,
  villageSizes,
} from './hollowed.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

describe('the Hollowed Communities cost model (#306)', () => {
  it('prices a village from COMMUNITY_RULES', () => {
    // 5 tiles × 4 pieces, each 6 Timber + 4 Stone + 1 Heartdust on meadow.
    expect(villageCost(5, 'meadow')).toEqual({ heartdust: 20, timber: 120, stone: 80 });
    expect(villageCost(4, 'lake')).toEqual(villageCost(4, 'meadow')); // `default`
  });

  it('finds Heartdust as the explore tables do, more often on Hollowed land', () => {
    const ordinary = heartdustPerSearch('meadow');
    expect(ordinary).toBeGreaterThan(0.05);
    expect(ordinary).toBeLessThan(0.2);
    expect(hollowedDustPerSearch('meadow')).toBeCloseTo(
      ordinary * COMMUNITY_RULES.heartdustFindMultiplier,
    );
  });

  it('waits for the slowest resource', () => {
    const help = { resources: { timber: 10, stone: 100 }, searches: 10 };
    expect(daysToRestore({ timber: 25, stone: 100, heartdust: 1 }, help, 0.5)).toBe(3);
    expect(daysToRestore({ heartdust: 12 }, help, 0.3)).toBe(4);
    expect(daysToRestore({ glimmer: 1 }, help, 0.3)).toBe(Infinity);
  });
});

describe('runHollowed: the gate', () => {
  const rows = runHollowed(HOLLOWED_CONFIG, PROGRESSION_CONFIG);
  const casualAlone = rows.find((r) => r.kid === 'casual' && r.team === 'alone')!;

  it('lets a casual kid alone restore a 5-tile village within two weeks', () => {
    expect(casualAlone.days.get(5)).toBeLessThanOrEqual(HOLLOWED_CONFIG.gateDays);
  });

  it('lets a casual kid alone restore a village of every size within two weeks', () => {
    for (const size of villageSizes()) {
      expect(casualAlone.days.get(size)).toBeLessThanOrEqual(HOLLOWED_CONFIG.gateDays);
    }
  });

  it('is quicker with a helper and for an engaged kid, and renders', () => {
    for (const size of villageSizes()) {
      const days = (kid: string, team: string) =>
        rows.find((r) => r.kid === kid && r.team === team)!.days.get(size)!;
      expect(days('casual', 'with a helper')).toBeLessThanOrEqual(days('casual', 'alone'));
      expect(days('engaged', 'alone')).toBeLessThanOrEqual(days('casual', 'alone'));
      expect(days('engaged', 'with a helper')).toBeLessThanOrEqual(days('engaged', 'alone'));
    }
    expect(renderHollowed(rows, HOLLOWED_CONFIG, { seconds: 0 })).toContain('| casual | alone |');
  });
});
