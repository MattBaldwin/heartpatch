import {
  CARE_RULES,
  findAvoidedWords,
  type CareListResponse,
  type CareSquishy,
  type Species,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { CARE_TEXT, careDoneLine, careSheet, evolutionLine, speciesById } from './care-view.js';

const NOW = '2026-10-02T12:00:00.000Z';

const species = (id: string, name: string, color: string): Species => ({
  id,
  name,
  description: 'A test squishy.',
  element: 'shadow',
  feeling: 'sleepy',
  rarity: 'secret',
  baseStats: { hp: 50, attack: 40, defense: 45, speed: 60 },
  moves: ['a', 'b'],
  evolutions: [],
  visual: { body: 'blob', palette: [color], parts: ['sleepy-eyes'] },
  habitatPreferences: { elements: [], feelings: [] },
});

const squishy = (extra: Partial<CareSquishy> = {}): CareSquishy => ({
  id: '0190a8c4-0000-7000-8000-000000000101',
  speciesId: 'moonpuff',
  element: 'shadow',
  feeling: 'sleepy',
  nickname: null,
  level: 4,
  xp: 200,
  xpIntoLevel: 15,
  xpToNext: 60,
  stats: { hp: 20, attack: 8, defense: 8, speed: 9 },
  contentment: 50,
  mood: 'happy',
  xpBonusPercent: 137,
  habitatId: null,
  caredToday: 1,
  fullCareLeft: 2,
  nextCareAt: {},
  newEvolution: null,
  ...extra,
});

const reply = (extra: Partial<CareListResponse> = {}): CareListResponse => ({
  squishies: [],
  speciesDefs: [
    species('moonpuff', 'Moonpuff', '#3b3561'),
    species('moonmallow', 'Moonmallow', '#c9b8ff'),
  ],
  items: { treats: 2 },
  coinsToday: 0,
  now: NOW,
  ...extra,
});

describe('careSheet', () => {
  it('shows the mood, hearts, level and XP bar', () => {
    const model = careSheet(squishy(), reply());
    expect(model).toMatchObject({
      name: 'Moonpuff',
      color: '#3b3561',
      mood: 'Happy and bouncy!',
      hearts: 0.5,
      level: 'Level 4',
      xp: 0.25,
      xpLine: '15 / 60 XP',
    });
    expect(model.buttons.map((b) => [b.action, b.note])).toEqual([
      ['feed', null],
      ['pet', null],
      ['play', null],
    ]);
    expect(model.buttons[0]!.label).toContain('2 Treats');
    expect(model.info).toEqual([
      'Battles give ×1.37 XP right now.',
      '2 more extra-special cuddles today.',
    ]);
  });

  it('greys out an action that just happened, and feeding without Treats', () => {
    const model = careSheet(
      squishy({ nextCareAt: { pet: '2026-10-02T12:00:05.000Z' } }),
      reply({ items: {} }),
    );
    expect(Object.fromEntries(model.buttons.map((b) => [b.action, b.note]))).toEqual({
      feed: CARE_TEXT.noTreats,
      pet: CARE_TEXT.wait,
      play: null,
    });
  });

  it('fills the bar at the top level, and says so', () => {
    const model = careSheet(squishy({ level: 100, xpToNext: null }), reply());
    expect(model).toMatchObject({ xp: 1, xpLine: 'Top level!' });
    expect(careSheet(squishy({ xpBonusPercent: 100 }), reply()).info[0]).toContain('normal XP');
  });

  it('uses a nickname when there is one', () => {
    expect(careSheet(squishy({ nickname: 'Pip' }), reply()).name).toBe('Pip');
  });
});

describe('lines', () => {
  it('cheers a care action, and the coins it earned', () => {
    const result = { action: 'pet', squishyId: squishy().id, contentmentGained: 10 };
    expect(careDoneLine({ ...result, full: true, coins: 1 })).toBe(
      'So soft! They wiggle happily. +1 Patch Coin',
    );
    expect(careDoneLine({ ...result, full: false, coins: 0 })).toBe(CARE_TEXT.lessNow);
  });

  it('celebrates an evolution with both names', () => {
    const evolved = squishy({
      speciesId: 'moonmallow',
      newEvolution: {
        fromSpeciesId: 'moonpuff',
        intoSpeciesId: 'moonmallow',
        level: 20,
        at: NOW,
      },
    });
    expect(evolutionLine(evolved, speciesById(reply()))).toBe('Moonpuff grew into Moonmallow!');
    expect(evolutionLine(squishy(), speciesById(reply()))).toBeNull();
  });

  it('uses no avoided words', () => {
    const { done, ...rest } = CARE_TEXT;
    const texts = [
      ...Object.values(done),
      ...Object.values(rest).filter((t) => typeof t === 'string'),
      CARE_TEXT.level(3),
      CARE_TEXT.xp(1, 2),
      CARE_TEXT.treats(1),
      CARE_TEXT.coins(2),
      CARE_TEXT.bonus(300),
      CARE_TEXT.bonus(100),
      CARE_TEXT.fullLeft(1),
      CARE_TEXT.evolved('Moonpuff', 'Moonmallow'),
      ...CARE_RULES.moods.map((m) => m.line),
    ];
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });
});
