import { describe, expect, it } from 'vitest';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { TRAVEL_RULES } from '../data/travel.js';
import type { TravelRules } from '../schemas/data/travel.js';
import { roadCost, roadRefund, roadSpeedPercent, roadSpent, topRoadLevel } from './roads.js';

const RULES: Pick<TravelRules, 'roads'> = {
  roads: {
    levels: [
      { cost: { timber: 4 }, reach: 1, speedPercent: 105 },
      { cost: { timber: 6, stone: 6 }, reach: 2, speedPercent: 110 },
      { cost: { stone: 12, glimmer: 1 }, reach: 3, speedPercent: 120 },
    ],
  },
};

describe('roads (Wild Isle, #621)', () => {
  it('costs each level to lay or raise, nothing past the top', () => {
    expect(topRoadLevel(RULES)).toBe(3);
    expect(roadCost(1, RULES)).toEqual({ timber: 4 });
    expect(roadCost(3, RULES)).toEqual({ stone: 12, glimmer: 1 });
    expect(roadCost(4, RULES)).toBeNull();
    expect(roadCost(0, RULES)).toBeNull();
  });

  it('adds up what a road cost, and gives the take-down share back', () => {
    expect(roadSpent(3, RULES)).toEqual({ timber: 10, stone: 18, glimmer: 1 });
    expect(roadRefund(1, RULES, { removeRefundPercent: 50 })).toEqual({ timber: 2 });
    // Half a Glimmer rounds down to none, and isn't listed.
    expect(roadRefund(3, RULES, { removeRefundPercent: 50 })).toEqual({ timber: 5, stone: 9 });
  });

  it('speeds a gatherer on the road by its level', () => {
    expect(roadSpeedPercent(null, RULES)).toBeNull();
    expect(roadSpeedPercent(1, RULES)).toBe(105);
    expect(roadSpeedPercent(3, RULES)).toBe(120);
  });

  it('reads the shipped rules', () => {
    expect(roadRefund(1, TRAVEL_RULES, HOME_BASE_RULES)).toEqual({ timber: 2 });
    expect(roadSpeedPercent(topRoadLevel(TRAVEL_RULES), TRAVEL_RULES)).toBeGreaterThan(100);
  });
});
