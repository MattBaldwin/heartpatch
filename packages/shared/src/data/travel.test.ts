import { describe, expect, it } from 'vitest';
import { checkTravelRules } from '../schemas/data/travel.js';
import { RESOURCES } from './resources.js';
import { TRAVEL_RULES } from './travel.js';

const resourceIds = new Set(RESOURCES.map((r) => r.id));

describe('travel rules (Wild Isle, #621)', () => {
  it('pass their checks', () => {
    expect(checkTravelRules(TRAVEL_RULES, resourceIds)).toEqual([]);
  });

  it('have three road levels, Path to Paved road, each reaching further and quicker', () => {
    expect(TRAVEL_RULES.roads.levels.map((l) => [l.reach, l.speedPercent])).toEqual([
      [1, 105],
      [2, 110],
      [3, 120],
    ]);
    expect(TRAVEL_RULES.bridgesShared).toBe(true);
    expect(TRAVEL_RULES.ferry).toEqual({ range: 6, oneDockPerLake: true });
  });

  it('catch a broken table', () => {
    const [path, road, paved] = TRAVEL_RULES.roads.levels;
    const broken = {
      ...TRAVEL_RULES,
      roads: {
        levels: [
          { ...path!, cost: { moonbeams: 1 } },
          { ...road!, reach: 0 },
          { ...paved!, speedPercent: 104 },
        ],
      },
    };
    expect(checkTravelRules(broken, resourceIds).join('\n')).toMatch(/reach/);
    const shrinking = {
      ...TRAVEL_RULES,
      roads: {
        levels: [
          { ...path!, cost: { moonbeams: 1 } },
          { ...road!, reach: 1, speedPercent: 104 },
        ],
      },
    };
    const problems = checkTravelRules(shrinking, resourceIds).join('\n');
    expect(problems).toMatch(/roads.levels.0.cost.moonbeams: unknown resource "moonbeams"/);
    expect(problems).toMatch(/roads.levels.1.speedPercent: slower than below/);
    expect(checkTravelRules({ ...TRAVEL_RULES, ferry: { range: 0 } }, resourceIds)).not.toEqual([]);
  });
});
