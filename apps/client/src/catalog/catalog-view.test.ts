import { findAvoidedWords, type Catalog, type Species } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { catalogPage } from './catalog-view.js';

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
    expect(page.progress).toBe('No squishies yet. Go find some!');
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
    expect(page.progress).toBe('Seen 2 of 2 · Friends 1');
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
      page.progress,
      catalogPage(ROSTER, catalog()).progress,
      'Squishy Catalog',
      'Friend ♥',
      'Seen',
      'Close',
      '???',
    ];
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });
});
