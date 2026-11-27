import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { BOSS_EVENTS } from '../data/server/boss-events.js';
import { QUIET_NIGHTS } from '../data/server/long-night.js';
import { SECRET_SPECIES } from '../data/server/secret-species.js';
import { checkBossEventRules, type BossEventRules } from '../schemas/data/boss-events.js';
import { isLongNight, nextLongNight, weekdayOf } from '../long-night/index.js';
import { bossVisitFor, bossWeekOf, christmasEveVisitFor } from './schedule.js';

// The Christmas Eve visit's schedule (#37 X1).
const BAG: BossEventRules['bag'] = [
  { speciesId: 'a', terrains: ['forest'] },
  { speciesId: 'b', terrains: ['meadow'] },
  { speciesId: 'c', terrains: ['marsh'] },
  { speciesId: 'd', terrains: ['mountain'] },
];
const EVE = BOSS_EVENTS.christmasEve!;
const RULES: BossEventRules = { ...BOSS_EVENTS, bag: BAG };
const WITH_SPECIES: BossEventRules = { ...RULES, christmasEve: { ...EVE, speciesId: 'frost' } };

describe('the Christmas Eve visit schedule (#37 X1)', () => {
  it('replaces the bag draw in the week holding Dec 24, every year', () => {
    // 2026: a Thursday; 2027: a Friday; 2028: a Sunday; 2029: a Monday.
    for (const [year, monday] of [
      ['2026', '2026-12-21'],
      ['2027', '2027-12-20'],
      ['2028', '2028-12-18'],
      ['2029', '2029-12-24'],
    ] as const) {
      expect(bossWeekOf(`${year}-12-24`)).toBe(monday);
      expect(christmasEveVisitFor('seed', monday, WITH_SPECIES)).toEqual({
        boss: { speciesId: 'frost', terrains: EVE.terrains },
        opensOn: `${year}-12-24`,
        closesOn: `${year}-12-25`,
      });
    }
  });

  it('leaves every other week to the bag, which resumes untouched after', () => {
    expect(christmasEveVisitFor('seed', '2026-12-14', WITH_SPECIES)).toBeNull();
    expect(christmasEveVisitFor('seed', '2026-12-28', WITH_SPECIES)).toBeNull();
    // The bag's draw for the week after is the same with or without the Eve block.
    const plain = { ...RULES, christmasEve: undefined };
    expect(bossVisitFor('seed', '2026-12-28', 3, WITH_SPECIES)).toEqual(
      bossVisitFor('seed', '2026-12-28', 3, plain),
    );
    expect(christmasEveVisitFor('seed', '2026-12-21', plain)).toBeNull();
  });

  it('runs with the week’s bag boss standing in until the species lands (X3)', () => {
    expect(EVE.speciesId).toBeNull();
    const plan = christmasEveVisitFor('seed', '2026-12-21', RULES)!;
    const draw = bossVisitFor('seed', '2026-12-21', null, RULES)!;
    expect(plan.boss).toEqual({ speciesId: draw.boss.speciesId, terrains: EVE.terrains });
    // No species and nothing in the bag: no visit at all.
    expect(christmasEveVisitFor('seed', '2026-12-21', { ...RULES, bag: [] })).toBeNull();
  });
});

describe('the Christmas Eve rules check (#37 X1)', () => {
  const species = new Set([...GAME_DATA.species, ...SECRET_SPECIES].map((s) => s.id));
  const terrains = new Set(GAME_DATA.terrains.map((t) => t.id));
  const check = (eve: object) =>
    checkBossEventRules({ ...BOSS_EVENTS, christmasEve: eve }, species, terrains);

  it('passes the shipped data', () => {
    expect(checkBossEventRules(BOSS_EVENTS, species, terrains)).toEqual([]);
  });

  it('bounds the level bonus, the player gate and the contributor fights', () => {
    expect(
      check({ ...EVE, gates: { ...EVE.gates, levelBonus: BOSS_EVENTS.levelBonus + 1 } }),
    ).toEqual(['christmas eve: levelBonus is above the weekly one']);
    expect(
      check({ ...EVE, gates: { ...EVE.gates, minPlayerLevel: 9, minPartnerLevel: 8 } }),
    ).toEqual(['christmas eve: minPlayerLevel is above minPartnerLevel']);
    expect(check({ ...EVE, contributorMinFights: BOSS_EVENTS.triesPerDay + 1 })).toEqual([
      'christmas eve: contributorMinFights is above triesPerDay',
    ]);
  });
});

describe('quiet nights (#37 X1)', () => {
  // 2026-12-24 is a Thursday (weekday 4).
  const THURSDAY = weekdayOf('2026-12-24');

  it('never runs a Long Night on Christmas Eve, and the next is a week on', () => {
    expect(THURSDAY).toBe(4);
    expect(isLongNight(THURSDAY, '2026-12-24', '2026-12-17')).toBe(true);
    expect(isLongNight(THURSDAY, '2026-12-24', '2026-12-17', QUIET_NIGHTS)).toBe(false);
    expect(isLongNight(THURSDAY, '2026-12-31', '2026-12-17', QUIET_NIGHTS)).toBe(true);
    const next = nextLongNight(
      { date: '2026-12-22', minute: 600 },
      THURSDAY,
      '2026-12-17',
      { nightfallMinute: 1140 },
      QUIET_NIGHTS,
    );
    expect(next).toEqual({ date: '2026-12-31', minute: 1140 });
  });

  it('finds the next Night past the 6-night guard and a quiet night together', () => {
    // A Long Night on Saturday 12 Dec, then the owner moved the day to
    // Thursday: the 17th is guarded, the 24th is quiet, so it's the 31st.
    const next = nextLongNight(
      { date: '2026-12-16', minute: 600 },
      THURSDAY,
      '2026-12-12',
      { nightfallMinute: 1140 },
      QUIET_NIGHTS,
    );
    expect(next).toEqual({ date: '2026-12-31', minute: 1140 });
  });

  it('changes nothing on other nights or without the list', () => {
    expect(isLongNight(THURSDAY, '2026-12-17', '2026-12-10', QUIET_NIGHTS)).toBe(true);
    expect(isLongNight(THURSDAY, '2026-12-24', null)).toBe(true);
  });
});
