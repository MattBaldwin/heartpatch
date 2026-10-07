import { describe, expect, it } from 'vitest';
import { checkSpawnRules } from '../../schemas/data/spawn-rules.js';
import { SPAWN_RULES } from './spawn-rules.js';

describe('spawn rules', () => {
  it('accepts the shipped rules', () => {
    expect(checkSpawnRules(SPAWN_RULES)).toEqual([]);
  });

  it('refuses windows that don’t divide a day, and muddled times of day', () => {
    expect(checkSpawnRules({ ...SPAWN_RULES, windowHours: 5 }).join()).toMatch(/divide 24/);
    expect(checkSpawnRules({ ...SPAWN_RULES, levels: { min: 6, max: 2 } }).join()).toMatch(/min/);
    expect(
      checkSpawnRules({ ...SPAWN_RULES, timesOfDay: [{ from: 6, timeOfDay: 'day' }] }).join(),
    ).toMatch(/starts at 0/);
    expect(
      checkSpawnRules({
        ...SPAWN_RULES,
        timesOfDay: [
          { from: 0, timeOfDay: 'night' },
          { from: 0, timeOfDay: 'day' },
        ],
      }).join(),
    ).toMatch(/earliest first/);
    expect(checkSpawnRules({ ...SPAWN_RULES, rarityLevelDiscount: { rare: -1 } }).join()).not.toBe(
      '',
    );
    expect(checkSpawnRules({ ...SPAWN_RULES, rarityLevelDiscount: { shiny: 1 } }).join()).not.toBe(
      '',
    );
  });
});
