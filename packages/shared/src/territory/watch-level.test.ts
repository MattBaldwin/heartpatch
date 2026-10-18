import { describe, expect, it } from 'vitest';
import { TERRITORY_RULES } from '../data/territory.js';
import { atWatchLevel, watchFloor } from './watch-level.js';

describe('guard level floor (#529)', () => {
  const rules = { partnerBonus: 3 };

  it('lifts a guard under the floor and leaves a stronger one alone', () => {
    const team = [
      { id: 'small', speciesId: 'emberbun', level: 8 },
      { id: 'big', speciesId: 'fuzzbolt', level: 20 },
    ];
    const lifted = atWatchLevel(team, watchFloor(15, rules));
    expect(lifted.map((s) => s.level)).toEqual([18, 20]);
    // Everything else is kept, and the stored squishies are untouched.
    expect(lifted[0]).toEqual({ id: 'small', speciesId: 'emberbun', level: 18 });
    expect(team.map((s) => s.level)).toEqual([8, 20]);
    expect(lifted[0]).not.toBe(team[0]);
  });

  it('a lifted squishy drops stats meant for its own level, a stronger one keeps them', () => {
    const stats = { hp: 30, attack: 10, defense: 10, speed: 10 };
    const [lifted, kept] = atWatchLevel(
      [
        { id: 'small', level: 5, stats },
        { id: 'big', level: 30, stats },
      ],
      12,
    );
    expect(lifted).toEqual({ id: 'small', level: 12 });
    expect(kept).toEqual({ id: 'big', level: 30, stats });
  });

  it('no Partner level, no floor', () => {
    expect(watchFloor(null, rules)).toBeNull();
    const team = [{ id: 'g', level: 7 }];
    expect(atWatchLevel(team, null)).toEqual([{ id: 'g', level: 7 }]);
  });

  it('reads the bonus from the rules and caps at 100', () => {
    expect(watchFloor(10, TERRITORY_RULES.guardLevel)).toBe(
      10 + TERRITORY_RULES.guardLevel.partnerBonus,
    );
    expect(watchFloor(10, { partnerBonus: 0 })).toBe(10);
    expect(atWatchLevel([{ level: 40 }, { level: 100 }], watchFloor(99, rules))).toEqual([
      { level: 100 },
      { level: 100 },
    ]);
  });
});
