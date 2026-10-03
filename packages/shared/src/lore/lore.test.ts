import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { LORE_PAGES } from '../data/server/lore-pages.js';
import { checkLoreData, type LoreEntry } from '../schemas/data/lore-pages.js';
import { loreFinds } from './index.js';

const KID = '11111111-1111-4111-8111-111111111111';

describe('lore pages', () => {
  it('ships one Glade page and two for patches, all valid', () => {
    expect(checkLoreData(LORE_PAGES)).toEqual([]);
    expect(LORE_PAGES.filter((p) => p.trigger.mapKinds.includes('tutorial'))).toHaveLength(1);
    expect(LORE_PAGES.filter((p) => p.trigger.mapKinds.includes('multiplayer'))).toHaveLength(2);
  });

  it('keeps the words kind (style guide §8, §9)', () => {
    for (const page of LORE_PAGES) {
      expect(findAvoidedWords(page.title)).toEqual([]);
      expect(findAvoidedWords(page.text)).toEqual([]);
    }
  });

  it('names doubled ids, unknown payload fields and a Glade finder on patches', () => {
    const page = structuredClone(LORE_PAGES[1]!);
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
    ];
    expect(checkLoreData(bad)).toEqual([
      '["the-tidied-clearing"].id: "the-tidied-clearing" is listed twice',
      '["the-tidied-clearing"].trigger.where[0].field: "tile.captured" has no "colour"',
      '["the-tidied-clearing"].trigger.finder: only a tutorial map has one player to find it',
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

  it('checks the conditions on the payload, and credits the actor', () => {
    expect(loreFinds(LORE_PAGES, captured('meadow'), 'multiplayer', null)).toEqual([]);
    expect(loreFinds(LORE_PAGES, captured('old-forest'), 'multiplayer', null)).toEqual([
      { pageId: 'the-tidied-clearing', userId: KID },
    ]);
    expect(loreFinds(LORE_PAGES, captured('old-forest'), 'tutorial', KID)).toEqual([]);
  });
});
