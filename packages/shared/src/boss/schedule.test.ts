import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { BOSS_EVENTS } from '../data/server/boss-events.js';
import { SECRET_SPECIES } from '../data/server/secret-species.js';
import { checkBossEventRules, type BossEventRules } from '../schemas/data/boss-events.js';
import { addDays } from '../home/local-date.js';
import { weekdayOf } from '../long-night/index.js';
import { bossLevelFor, bossTileFor, bossVisitFor, bossWeekOf } from './schedule.js';

const BAG: BossEventRules['bag'] = [
  { speciesId: 'a', terrains: ['forest'] },
  { speciesId: 'b', terrains: ['meadow'] },
  { speciesId: 'c', terrains: ['marsh'] },
  { speciesId: 'd', terrains: ['mountain'] },
];
const RULES = { ...BOSS_EVENTS, bag: BAG };

describe('boss schedule (#190)', () => {
  it('names a visit by the patch-local Monday of its week', () => {
    expect(bossWeekOf('2026-11-16')).toBe('2026-11-16'); // a Monday
    expect(bossWeekOf('2026-11-22')).toBe('2026-11-16'); // that Sunday
    expect(bossWeekOf('2026-11-15')).toBe('2026-11-09');
  });

  it('is stable: the same seed and week give the same visit', () => {
    const one = bossVisitFor('seed', '2026-11-16', 6, RULES);
    expect(bossVisitFor('seed', '2026-11-16', 6, RULES)).toEqual(one);
    expect(one).not.toBeNull();
  });

  it('brings every boss once before any repeats', () => {
    // Weeks 0..3 of a bag cycle (weeks since 1970-01-05, multiples of 4).
    let week = '2026-11-16';
    while (Math.round((Date.parse(week) - Date.parse('1970-01-05')) / 6048e5) % 4 !== 0) {
      week = addDays(week, 7);
    }
    const seen = [0, 1, 2, 3].map(
      (i) => bossVisitFor('seed', addDays(week, 7 * i), 6, RULES)!.boss.speciesId,
    );
    expect(new Set(seen).size).toBe(4);
  });

  it('opens inside its week and never covers the Long Night', () => {
    for (let w = 0; w < 30; w++) {
      const week = addDays('2026-11-16', 7 * w);
      for (const night of [0, 3, 6]) {
        const visit = bossVisitFor(`seed-${w}`, week, night, RULES)!;
        expect(bossWeekOf(visit.opensOn)).toBe(week);
        expect(weekdayOf(visit.opensOn)).not.toBe(night);
        expect(weekdayOf(addDays(visit.opensOn, 1))).not.toBe(night);
        expect(bossWeekOf(addDays(visit.opensOn, 2))).toBe(week);
      }
    }
  });

  it('has no visits with an empty bag (production until #234)', () => {
    expect(BOSS_EVENTS.bag).toEqual([]);
    expect(bossVisitFor('seed', '2026-11-16', 6, BOSS_EVENTS)).toBeNull();
  });

  it('stands on liked terrain, nearest to the farthest home', () => {
    const homes = [
      { q: 0, r: 0 },
      { q: 6, r: 0 },
    ];
    const tiles = [
      { q: 3, r: 0, terrain: 'meadow' },
      { q: 1, r: 0, terrain: 'forest' },
      { q: 3, r: -1, terrain: 'forest' },
      { q: 9, r: 0, terrain: 'forest' },
    ];
    expect(bossTileFor('seed', '2026-11-16', BAG[0]!, tiles, homes)).toEqual({ q: 3, r: -1 });
    // Nothing liked: the fairest of the rest.
    expect(bossTileFor('seed', '2026-11-16', BAG[2]!, tiles, homes)).toEqual({ q: 3, r: 0 });
    expect(bossTileFor('seed', '2026-11-16', BAG[0]!, [], homes)).toBeNull();
  });

  it("levels the boss at the Keeper's Partner plus two, at least 15", () => {
    expect(bossLevelFor(20, RULES, 50)).toBe(22);
    expect(bossLevelFor(5, RULES, 50)).toBe(15);
    expect(bossLevelFor(50, RULES, 50)).toBe(50);
  });

  it('checks the rules: the shipped ones, and a bad bag', () => {
    // Ruling (#190 round 2): boss species live in SECRET_SPECIES with line 'boss'.
    const species = new Set(SECRET_SPECIES.filter((s) => s.line === 'boss').map((s) => s.id));
    const terrains = new Set(GAME_DATA.terrains.map((t) => t.id));
    const items = new Set(GAME_DATA.resources.map((r) => r.id));
    expect(checkBossEventRules(BOSS_EVENTS, species, terrains, items)).toEqual([]);
    expect(
      checkBossEventRules({ ...BOSS_EVENTS, bundle: { nothing: 1 } }, species, terrains, items),
    ).toEqual(['boss bundle: unknown item "nothing"']);
    expect(checkBossEventRules({ ...BOSS_EVENTS, bundle: {} }, species, terrains)).toEqual([
      'boss rules: the bundle is empty',
    ]);
    const bad = { ...BOSS_EVENTS, bag: [{ speciesId: 'nobody', terrains: ['nowhere'] }] };
    expect(checkBossEventRules(bad, species, terrains)).toEqual([
      'boss bag: unknown species "nobody"',
      'boss bag: "nobody" likes unknown terrain "nowhere"',
    ]);
  });
});
