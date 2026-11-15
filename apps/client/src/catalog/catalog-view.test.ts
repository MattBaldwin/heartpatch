import { findAvoidedWords, type Catalog, type Species } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { catalogPage, tierText } from './catalog-view.js';

const species = (
  id: string,
  name: string,
  color = '#ffaa00',
  rarity: Species['rarity'] = 'common',
): Species => ({
  id,
  name,
  description: 'A squishy.',
  element: 'fire',
  feeling: 'cozy',
  rarity,
  baseStats: { hp: 50, attack: 40, defense: 45, speed: 60 },
  moves: ['a', 'b'],
  evolutions: [],
  visual: { body: 'blob', palette: [color], parts: ['oval-eyes'] },
  habitatPreferences: { elements: [], feelings: [] },
});

const ROSTER = [
  species('emberbun', 'Emberbun', '#ff8844', 'rare'),
  species('puddlepuff', 'Puddlepuff'),
];
const SEEN_AT = '2026-10-02T18:00:00.000Z';

const catalog = (over: Partial<Catalog> = {}): Catalog => ({
  entries: [],
  speciesDefs: [],
  ...over,
});

describe('catalogPage (design doc §21: seen vs caught)', () => {
  it('shows every public squishy, unseen ones as ???', () => {
    const page = catalogPage(ROSTER, catalog());
    expect(page.cards.map((c) => c.name)).toEqual([null, null]);
    expect(page.cards.every((c) => c.color === null && !c.seen && !c.caught)).toBe(true);
    // Unseen cards keep their rarity hidden too (#240).
    expect(page.cards.map((c) => c.rarity)).toEqual([null, null]);
    expect(page).toMatchObject({ seen: 0, caught: 0, total: 2 });
    expect(page.tiers).toEqual([
      { rarity: 'common', caught: 0, seen: 0, total: 1, done: false, current: true },
      { rarity: 'rare', caught: 0, seen: 0, total: 1, done: false, current: false },
    ]);
  });

  it('names seen squishies and marks friends', () => {
    const page = catalogPage(
      ROSTER,
      catalog({
        entries: [
          { speciesId: 'emberbun', firstSeenAt: SEEN_AT, firstCaughtAt: SEEN_AT },
          { speciesId: 'puddlepuff', firstSeenAt: SEEN_AT, firstCaughtAt: null },
        ],
      }),
    );
    expect(page.cards).toEqual([
      {
        speciesId: 'emberbun',
        name: 'Emberbun',
        color: '#ff8844',
        rarity: 'rare',
        seen: true,
        caught: true,
        secret: false,
      },
      {
        speciesId: 'puddlepuff',
        name: 'Puddlepuff',
        color: '#ffaa00',
        rarity: 'common',
        seen: true,
        caught: false,
        secret: false,
      },
    ]);
  });

  it('adds a secret squishy only once it has been seen', () => {
    const moonpuff = species('moonpuff', 'Moonpuff', '#3b3561', 'secret');
    // A row without a seen entry stays off the page.
    expect(catalogPage(ROSTER, catalog({ speciesDefs: [moonpuff] })).total).toBe(2);
    const page = catalogPage(
      ROSTER,
      catalog({
        entries: [{ speciesId: 'moonpuff', firstSeenAt: SEEN_AT, firstCaughtAt: null }],
        speciesDefs: [moonpuff],
      }),
    );
    expect(page.cards.at(-1)).toMatchObject({
      name: 'Moonpuff',
      rarity: 'secret',
      secret: true,
      seen: true,
    });
    expect(page).toMatchObject({ seen: 1, total: 3 });
  });

  it("shows a met squishy's rarity but never an unmet one's (#240)", () => {
    const page = catalogPage(
      ROSTER,
      catalog({
        entries: [{ speciesId: 'puddlepuff', firstSeenAt: SEEN_AT, firstCaughtAt: null }],
      }),
    );
    const byId = new Map(page.cards.map((c) => [c.speciesId, c]));
    expect(byId.get('puddlepuff')?.rarity).toBe('common');
    // Emberbun is rare, but it hasn't been met, so its card says nothing.
    expect(byId.get('emberbun')).toMatchObject({ seen: false, name: null, rarity: null });
  });

  it('uses no avoided words (style guide §9)', () => {
    const page = catalogPage(
      ROSTER,
      catalog({
        entries: [{ speciesId: 'emberbun', firstSeenAt: SEEN_AT, firstCaughtAt: SEEN_AT }],
      }),
    );
    const texts = [
      ...page.tiers.map(tierText),
      ...catalogPage(ROSTER, catalog()).tiers.map(tierText),
      'All found!',
      'Squishy Catalog',
      'Friend ♥',
      'Seen',
      'Close',
      '???',
    ];
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });

  describe('per-tier goal (#732)', () => {
    const met = (id: string, caught = true) => ({
      speciesId: id,
      firstSeenAt: SEEN_AT,
      firstCaughtAt: caught ? SEEN_AT : null,
    });
    const BIG = [
      species('a', 'A'),
      species('b', 'B'),
      species('c', 'C', '#fff', 'uncommon'),
      { ...species('boo', 'Boo', '#fff', 'uncommon'), season: 'halloween' },
    ];

    it('counts friends per tier, in order, with the first unfinished one current', () => {
      const page = catalogPage(BIG, catalog({ entries: [met('a'), met('b', false)] }));
      expect(page.tiers).toEqual([
        { rarity: 'common', caught: 1, seen: 2, total: 2, done: false, current: true },
        { rarity: 'uncommon', caught: 0, seen: 0, total: 1, done: false, current: false },
      ]);
      expect(tierText(page.tiers[0]!)).toBe('1 of 2 friends · 2 seen');
      expect(tierText(page.tiers[1]!)).toBe('0 of 1 friends');
    });

    it('reads a finished tier as done and moves the finish line on', () => {
      const page = catalogPage(BIG, catalog({ entries: [met('a'), met('b')] }));
      expect(page.tiers.map((t) => [t.rarity, t.done, t.current])).toEqual([
        ['common', true, false],
        ['uncommon', false, true],
      ]);
      expect(tierText(page.tiers[0]!)).toBe('All found!');
    });

    it('counts a seasonal kind only while its season is on, or once met', () => {
      const out = catalogPage(BIG, catalog());
      expect(out.tiers.find((t) => t.rarity === 'uncommon')?.total).toBe(1);
      const inSeason = catalogPage(BIG, catalog(), ['halloween']);
      expect(inSeason.tiers.find((t) => t.rarity === 'uncommon')?.total).toBe(2);
      // A friend made in season keeps counting after it ends.
      const kept = catalogPage(BIG, catalog({ entries: [met('boo')] }));
      expect(kept.tiers.find((t) => t.rarity === 'uncommon')).toMatchObject({
        caught: 1,
        total: 2,
      });
    });

    it('keeps secrets out of the tiers and hides empty tiers', () => {
      const moonpuff = species('moonpuff', 'Moonpuff', '#3b3561', 'secret');
      const page = catalogPage(
        BIG,
        catalog({ entries: [met('moonpuff')], speciesDefs: [moonpuff] }),
      );
      expect(page.cards.some((c) => c.secret)).toBe(true);
      expect(page.tiers.map((t) => t.rarity)).toEqual(['common', 'uncommon']);
      expect(page.tiers.reduce((n, t) => n + t.total, 0)).toBe(3);
    });

    it('shows no finish line once every tier is done', () => {
      const page = catalogPage([species('a', 'A')], catalog({ entries: [met('a')] }));
      expect(page.tiers).toEqual([
        { rarity: 'common', caught: 1, seen: 1, total: 1, done: true, current: false },
      ]);
    });

    it('never orders or labels unmet cards by tier (#240)', () => {
      const page = catalogPage(BIG, catalog());
      expect(page.cards.map((c) => c.speciesId)).toEqual(['a', 'b', 'c', 'boo']);
      expect(page.cards.every((c) => c.rarity === null)).toBe(true);
    });
  });
});
