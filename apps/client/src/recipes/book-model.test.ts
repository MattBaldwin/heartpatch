import {
  findAvoidedWords,
  recipeBookPages,
  RECIPE_BOOK,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  bookOrder,
  bookSpreads,
  bookTabs,
  craftTime,
  findSpot,
  freshPages,
  listWords,
  pageView,
  searchPages,
  spreadOf,
  whereText,
  type BookContext,
} from './book-model.js';

const PAGES = recipeBookPages();
const ctx = (over: Partial<BookContext> = {}): BookContext => ({
  unlocked: new Set(RECIPE_BOOK.alwaysOpen),
  bag: {},
  seasons: new Set(['halloween']),
  unseen: new Set(),
  ...over,
});
const view = (key: string, over: Partial<BookContext> = {}) => {
  const page = PAGES.find((p) => p.key === key);
  if (!page) throw new Error(`no page ${key}`);
  return pageView(page, ctx(over));
};

describe('recipe book pages', () => {
  it('keep have/need per ingredient, capped for the 0/1 display', () => {
    const charm = view('recipe:heart-charm', { bag: { timber: 5, treats: 0 } });
    expect(charm.ingredients.map((i) => [i.name, i.have, i.need, i.ok])).toEqual([
      ['Timber', 2, 2, true],
      ['Treats', 0, 1, false],
    ]);
    expect(charm.canMake).toBe(false);
    expect(charm.note).toBe('Still need 1 Treats');
    expect(charm.meta).toBe('Makes 1 Heart Charm · 1 min');
  });

  it('can be made with everything in the bag, in season', () => {
    expect(view('recipe:heart-charm', { bag: { timber: 2, treats: 1 } }).canMake).toBe(true);
    const treats = view('recipe:pumpkin-treats', {
      unlocked: new Set(['recipe:pumpkin-treats']),
      bag: { pumpkins: 1 },
    });
    expect(treats.canMake).toBe(true);
    const offSeason = view('recipe:pumpkin-treats', {
      unlocked: new Set(['recipe:pumpkin-treats']),
      bag: { pumpkins: 1 },
      seasons: new Set(),
    });
    expect(offSeason.canMake).toBe(false);
    expect(offSeason.note).toBe('Comes back at Halloween!');
  });

  it('never let a sealed page be made, and give it a public hint', () => {
    const jack = view('recipe:jack-o-lantern-hearthfire', {
      bag: { pumpkins: 9, emberwood: 9, 'witch-dust': 9 },
    });
    expect(jack.sealed).toBe(true);
    expect(jack.canMake).toBe(false);
    expect(jack.note).toBeNull();
    expect(jack.hint).toMatch(/Emberwood and Pumpkin/);
  });

  it('say buildings are built at home', () => {
    const den = view('building:ember-den', { bag: { timber: 5, stone: 3 } });
    expect(den.section).toBe('build');
    expect(den.meta).toBe('Build it at home');
    expect(den.canMake).toBe(true);
  });

  it('mark new pages only once open', () => {
    expect(view('recipe:heart-charm', { unseen: new Set(['recipe:heart-charm']) }).isNew).toBe(
      true,
    );
    expect(
      view('recipe:pumpkin-treats', { unseen: new Set(['recipe:pumpkin-treats']) }).isNew,
    ).toBe(false);
  });

  it('use kind words only', () => {
    for (const page of PAGES) {
      const v = pageView(page, ctx({ unlocked: new Set(PAGES.map((p) => p.key)) }));
      const words = [v.name, v.flavour, v.meta, v.hint, ...v.ingredients.map((i) => i.where)];
      expect(findAvoidedWords(words.join(' ')), page.key).toEqual([]);
    }
  });
});

describe('where to find it', () => {
  it('names terrains, the home ring, bonuses and recipes', () => {
    expect(whereText('timber')).toBe("Forest, Juniper's Gap and your home ring.");
    expect(whereText('witch-dust')).toBe('A surprise bonus when you gather Emberwood or Pumpkins.');
    expect(whereText('treats')).toBe('Your home ring, or make Pumpkin Treats.');
    expect(whereText('pumpkins')).toBe('Pumpkin Fields.');
  });

  it('says so kindly when nothing gives it yet', () => {
    expect(whereText('presents')).toBe('Nobody has found any yet. Keep exploring!');
  });

  it('gives a season note for seasonal things', () => {
    const treats = view('recipe:pumpkin-treats', { unlocked: new Set(['recipe:pumpkin-treats']) });
    expect(treats.ingredients[0]?.season).toBe('Only at Halloween');
  });

  it('never reads server-only data', () => {
    // CLAUDE.md rule 6: the book's client code only imports the public entry.
    const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThan(2);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/@heartpatch\/shared\/server|data\/server/);
    }
  });
});

describe('finding a spot on the map', () => {
  const me = '0190a8c4-0000-7000-8000-000000000001';
  const tile = (
    q: number,
    r: number,
    node: string | null,
    owner: string | null = me,
  ): PublicTile => ({
    q,
    r,
    terrain: 'meadow',
    ownerUserId: owner,
    nodeResource: node,
    homeSlot: q === 0 && r === 0 ? 1 : null,
    gathering: null,
    cooldownUntil: null,
    defenders: 0,
    guardianHint: null,
    buildings: [],
  });
  const tiles = [
    tile(0, 0, null),
    tile(4, 0, 'timber'),
    tile(1, 0, 'timber'),
    tile(0, 1, 'emberwood'),
    tile(2, 2, 'stone', null),
  ];

  it('picks my nearest tile with that node', () => {
    expect(findSpot('timber', tiles, me)).toEqual({ q: 1, r: 0 });
  });

  it('falls back to a tile whose gathers bring it as a bonus', () => {
    expect(findSpot('witch-dust', tiles, me)).toEqual({ q: 0, r: 1 });
  });

  it('ignores land that isn’t mine', () => {
    expect(findSpot('stone', tiles, me)).toBeNull();
  });
});

describe('the book', () => {
  const views = PAGES.map((p) =>
    pageView(
      p,
      ctx({
        unlocked: new Set([...RECIPE_BOOK.alwaysOpen, 'recipe:pumpkin-treats']),
        bag: { pumpkins: 1 },
      }),
    ),
  );

  it('searches open pages by name or ingredient, never sealed ones', () => {
    expect(searchPages(views, 'pump').map((p) => p.key)).toEqual(['recipe:pumpkin-treats']);
    expect(searchPages(views, 'STONE').map((p) => p.key)).toEqual([
      'building:hearthfire',
      'building:ember-den',
      'building:cozy-meadow',
    ]);
    expect(searchPages(views, 'witch')).toEqual([]);
    expect(searchPages(views, '  ').length).toBe(views.filter((v) => !v.sealed).length);
  });

  it('can show only what you can make now', () => {
    expect(bookOrder(views, true)).toEqual(['cover', 'contents', 'recipe:pumpkin-treats', 'end']);
    expect(bookOrder(views, false)).toHaveLength(PAGES.length + 3);
  });

  it('lays out one page at a time, or two-page spreads after the cover', () => {
    const order = ['cover', 'contents', 'a', 'b', 'c', 'end'];
    expect(bookSpreads(order, false)).toHaveLength(6);
    expect(bookSpreads(order, true)).toEqual([['cover'], ['contents', 'a'], ['b', 'c'], ['end']]);
    expect(spreadOf(bookSpreads(order, true), 'c')).toBe(2);
    expect(spreadOf(bookSpreads(order, true), 'gone')).toBe(0);
  });

  it('counts pages opened since the last look as new, but not on the first look', () => {
    expect(freshPages(['a', 'b'], null)).toEqual({ fresh: [], seen: new Set(['a', 'b']) });
    expect(freshPages(['a', 'b', 'c'], new Set(['a', 'b'])).fresh).toEqual(['c']);
  });

  it('formats small things', () => {
    expect(craftTime(30)).toBe('30 sec');
    expect(craftTime(300)).toBe('5 min');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listWords(['a', 'b'], 'or')).toBe('a or b');
  });
});

describe('ribbon tabs', () => {
  const views = PAGES.map((p) => pageView(p, ctx()));

  it('come from data: Make, Build and one per season on the pages', () => {
    expect(bookTabs(views).map((t) => t.label)).toEqual(['Make', 'Build', 'Halloween']);
    const halloween = bookTabs(views)[2]!;
    expect(views.filter(halloween.matches).map((p) => p.key)).toEqual([
      'recipe:pumpkin-treats',
      'recipe:jack-o-lantern-hearthfire',
      'building:jack-o-lantern-hearthfire',
    ]);
  });

  it('take a new part of the book as a new rule', () => {
    const tabs = bookTabs(views, [
      { id: 'food', label: 'Treats & food', color: '#ffd76a', outputs: ['treats'] },
      { id: 'charms', label: 'Charms', color: '#ff9ab8', outputKinds: ['crafted'] },
      { id: 'none', label: 'Nothing yet', color: '#fff', outputs: ['no-such-thing'] },
    ]);
    expect(tabs.map((t) => t.label)).toEqual(['Treats & food', 'Charms']);
    expect(views.filter(tabs[0]!.matches).map((p) => p.key)).toEqual(['recipe:pumpkin-treats']);
  });

  it('leave the effect line empty until something has one', () => {
    expect(views.every((v) => v.effect === null)).toBe(true);
  });
});
