import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { LORE_CHAPTERS, LORE_PAGES } from '../data/server/lore-pages.js';
import { checkLoreData, type LoreEntry } from '../schemas/data/lore-pages.js';
import { loreFinds } from './index.js';

const KID = '11111111-1111-4111-8111-111111111111';

describe('lore pages', () => {
  it('fills the book: 12 pages, 3 in each of 4 chapters, two on the Glade (#307), all valid', () => {
    expect(checkLoreData(LORE_PAGES, LORE_CHAPTERS)).toEqual([]);
    expect(LORE_PAGES).toHaveLength(12);
    for (const chapter of LORE_CHAPTERS) {
      const pages = LORE_PAGES.filter((p) => p.chapter === chapter.id);
      expect(pages.map((p) => p.order).sort()).toEqual([1, 2, 3]);
    }
    expect(LORE_PAGES.filter((p) => p.trigger.mapKinds.includes('tutorial'))).toHaveLength(2);
    expect(LORE_PAGES.filter((p) => p.trigger.eventType === 'explore.searched')).toHaveLength(5);
  });

  it('gives every page a short hint that never repeats its title or words', () => {
    for (const page of LORE_PAGES) {
      expect(page.hint.length).toBeGreaterThan(0);
      expect(page.hint.length).toBeLessThanOrEqual(60);
      expect(page.hint.toLowerCase()).not.toContain(page.title.toLowerCase());
      expect(page.text).not.toContain(page.hint);
    }
  });

  it('keeps the words kind (style guide §8, §9)', () => {
    for (const page of LORE_PAGES) {
      expect(findAvoidedWords(page.title)).toEqual([]);
      expect(findAvoidedWords(page.text)).toEqual([]);
      expect(findAvoidedWords(page.hint)).toEqual([]);
    }
  });

  it('names doubled ids, unknown payload fields and finders, and a Glade finder on patches', () => {
    const page = structuredClone(LORE_PAGES.find((p) => p.id === 'the-tidied-clearing')!);
    const bad: LoreEntry[] = [
      page,
      {
        ...page,
        trigger: {
          ...page.trigger,
          where: [{ op: 'equals', field: 'colour', value: 'red' }],
          finder: 'tutorial-player',
        },
      },
      {
        ...page,
        id: 'no-player',
        order: 4,
        trigger: {
          ...page.trigger,
          eventType: 'hollow.nightfall',
          where: [],
          finder: 'payload-user',
        },
      },
    ];
    expect(checkLoreData(bad, LORE_CHAPTERS)).toEqual([
      '["the-tidied-clearing"].id: "the-tidied-clearing" is listed twice',
      '["the-tidied-clearing"].order: "wild-lands" already has a page 1',
      '["the-tidied-clearing"].trigger.where[0].field: "tile.captured" has no "colour"',
      '["the-tidied-clearing"].trigger.finder: only a tutorial map has one player to find it',
      '["no-player"].trigger.finder: "hollow.nightfall" has no "userId" to find it',
    ]);
  });

  it('names a page in no chapter, and doubled chapters', () => {
    const page = structuredClone(LORE_PAGES[0]!);
    expect(checkLoreData([{ ...page, chapter: 'nowhere' }], LORE_CHAPTERS)).toEqual([
      '["where-the-squishies-bloomed"].chapter: no chapter "nowhere"',
    ]);
    const chapter = LORE_CHAPTERS[0]!;
    expect(checkLoreData([page], [chapter, { ...chapter }])).toEqual([
      '["junipers-gap"].id: "junipers-gap" is listed twice',
      '["junipers-gap"].order: two chapters are number 1',
    ]);
  });
});

describe('loreFinds', () => {
  const nightfall = {
    type: 'hollow.nightfall',
    actorUserId: null,
    payload: { night: '2026-10-03', taken: [] },
  };
  const captured = (terrain: string) => ({
    type: 'tile.captured',
    actorUserId: KID,
    payload: { terrain },
  });

  it("finds the Glade's page for its player on the Glade only", () => {
    expect(loreFinds(LORE_PAGES, nightfall, 'tutorial', KID)).toEqual([
      { pageId: 'paw-prints-by-the-fire', userId: KID },
    ]);
    expect(loreFinds(LORE_PAGES, nightfall, 'multiplayer', null)).toEqual([]);
    // No player to find it: nothing.
    expect(loreFinds(LORE_PAGES, nightfall, 'tutorial', null)).toEqual([]);
  });

  it("finds the Glade's seed page when the Heart Seed is planted", () => {
    const advanced = (completedStepId: string) => ({
      type: 'tutorial.advanced',
      actorUserId: KID,
      payload: { completedStepId, stepId: 'gather' },
    });
    expect(loreFinds(LORE_PAGES, advanced('plant'), 'tutorial', KID)).toEqual([
      { pageId: 'where-the-squishies-bloomed', userId: KID },
    ]);
    expect(loreFinds(LORE_PAGES, advanced('welcome'), 'tutorial', KID)).toEqual([]);
  });

  it("credits the payload's player for a squishy taken to the Hollow (no actor)", () => {
    const hollowed = {
      type: 'squishy.hollowed',
      actorUserId: null,
      payload: { userId: KID, squishyId: KID, night: '2026-10-03' },
    };
    expect(loreFinds(LORE_PAGES, hollowed, 'multiplayer', null)).toEqual([
      { pageId: 'grey-footprints', userId: KID },
    ]);
    expect(loreFinds(LORE_PAGES, { ...hollowed, payload: {} }, 'multiplayer', null)).toEqual([]);
  });

  it('checks the conditions on the payload, and credits the actor', () => {
    expect(loreFinds(LORE_PAGES, captured('meadow'), 'multiplayer', null)).toEqual([]);
    expect(loreFinds(LORE_PAGES, captured('old-forest'), 'multiplayer', null)).toEqual([
      { pageId: 'the-tidied-clearing', userId: KID },
    ]);
    expect(loreFinds(LORE_PAGES, captured('old-forest'), 'tutorial', KID)).toEqual([]);
  });
});
