import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { RECIPE_BOOK } from '../data/recipe-book.js';
import { TUTORIAL_SETUP } from '../data/tutorial/setup.js';
import { TUTORIAL_STEPS } from '../data/tutorial/steps.js';
import { checkRecipeBook } from '../schemas/data/recipe-book.js';
import { RecipeBookResponseSchema } from '../schemas/inventory.js';
import {
  buildingPageKey,
  canMakeNow,
  isPageUnlocked,
  recipeBookPages,
  recipePageKey,
  sealedHint,
  unlockedPageKeys,
  whereToFind,
} from './index.js';

const PAGES = recipeBookPages();
const page = (key: string) => PAGES.find((p) => p.key === key)!;
const unlocked = (collected: string[]) => unlockedPageKeys(PAGES, new Set(collected));

describe('recipe book pages', () => {
  it('lists every recipe, then every buildable building, in data order', () => {
    const buildable = GAME_DATA.buildings.filter((b) =>
      (HOME_BASE_RULES.buildableKinds as readonly string[]).includes(b.kind),
    );
    expect(PAGES.map((p) => p.key)).toEqual([
      ...GAME_DATA.recipes.map((r) => `recipe:${r.id}`),
      ...buildable.map((b) => `building:${b.id}`),
    ]);
    // Training Grounds are buildable now (owner decision 2026-10-06), so they have a page.
    expect(PAGES.some((p) => p.key === 'building:training-grounds')).toBe(true);
  });

  it('copies ingredients, timing, season and output from the data', () => {
    for (const r of GAME_DATA.recipes) {
      expect(page(recipePageKey(r.id))).toEqual({
        key: `recipe:${r.id}`,
        kind: 'recipe',
        id: r.id,
        name: r.name,
        description: r.description,
        ingredients: r.inputs,
        seconds: r.craftSeconds,
        season: r.season ?? null,
        output: { kind: 'item', resource: r.output.resource, quantity: r.output.quantity },
      });
    }
    expect(page(buildingPageKey('hearthfire'))).toMatchObject({
      kind: 'building',
      ingredients: { timber: 5, stone: 5 },
      seconds: null,
      season: null,
      output: { kind: 'building', building: 'hearthfire' },
    });
    expect(page(buildingPageKey('jack-o-lantern-hearthfire'))).toMatchObject({
      ingredients: { 'jack-o-lantern-hearthfire': 1 },
      season: 'halloween',
    });
  });

  it('gives a fresh copy each call, so a caller cannot change the data', () => {
    const first = recipeBookPages();
    first[0]!.ingredients['timber'] = 99;
    expect(recipeBookPages()[0]!.ingredients['timber']).not.toBe(99);
  });

  it('has valid recipe book data: real pages, a short kind hint for every sealable page', () => {
    expect(
      checkRecipeBook(
        RECIPE_BOOK,
        PAGES.map((p) => p.key),
      ),
    ).toEqual([]);
  });

  it('catches bad recipe book data', () => {
    const keys = PAGES.map((p) => p.key);
    expect(
      checkRecipeBook({ ...RECIPE_BOOK, alwaysOpen: ['recipe:golden-ticket'] }, keys),
    ).not.toEqual([]);
    expect(
      checkRecipeBook({ ...RECIPE_BOOK, alwaysOpen: ['spell:heart-charm'] }, keys),
    ).not.toEqual([]);
    expect(checkRecipeBook({ ...RECIPE_BOOK, sealedHints: [] }, keys)).not.toEqual([]);
    const noisy = RECIPE_BOOK.sealedHints.map((h, i) =>
      i === 0 ? { ...h, line: 'Beat the enemy to get this one!' } : h,
    );
    expect(checkRecipeBook({ ...RECIPE_BOOK, sealedHints: noisy }, keys)).toEqual([
      `sealedHints: "${RECIPE_BOOK.sealedHints[0]!.page}" uses the avoided word "enemy"`,
    ]);
    const long = RECIPE_BOOK.sealedHints.map((h, i) =>
      i === 0 ? { ...h, line: Array.from({ length: 21 }, () => 'squish').join(' ') } : h,
    );
    expect(checkRecipeBook({ ...RECIPE_BOOK, sealedHints: long }, keys)).not.toEqual([]);
  });

  it('only accepts page keys in the response schema', () => {
    expect(RecipeBookResponseSchema.safeParse({ unlocked: ['recipe:heart-charm'] }).success).toBe(
      true,
    );
    expect(RecipeBookResponseSchema.safeParse({ unlocked: ['heart-charm'] }).success).toBe(false);
  });
});

describe('unlocking pages', () => {
  it('opens the Heart Charm, Hearthfire and both habitats for a brand-new account', () => {
    expect([...unlocked([])]).toEqual([
      'recipe:heart-charm',
      'building:hearthfire',
      'building:ember-den',
      'building:cozy-meadow',
    ]);
    expect(sealedHint('recipe:heart-charm')).toBeNull();
  });

  it('opens a page the first time its last missing ingredient is collected', () => {
    expect(unlocked(['emberwood']).has('recipe:pumpkin-treats')).toBe(false);
    expect(unlocked(['emberwood', 'pumpkins']).has('recipe:pumpkin-treats')).toBe(true);
    expect(isPageUnlocked(page('recipe:pumpkin-treats'), new Set(['pumpkins']))).toBe(true);
  });

  it("keeps both Jack-o'-Lantern pages sealed until Witch Dust turns up", () => {
    const withoutDust = unlocked(['timber', 'stone', 'treats', 'emberwood', 'pumpkins', 'glimmer']);
    expect(withoutDust.has('recipe:jack-o-lantern-hearthfire')).toBe(false);
    expect(withoutDust.has('building:jack-o-lantern-hearthfire')).toBe(false);
    const withDust = unlocked(['emberwood', 'pumpkins', 'witch-dust']);
    expect(withDust.has('recipe:jack-o-lantern-hearthfire')).toBe(true);
    // The building is made from the crafted lantern: it opens once one has been collected.
    expect(withDust.has('building:jack-o-lantern-hearthfire')).toBe(false);
    expect(unlocked(['jack-o-lantern-hearthfire']).has('building:jack-o-lantern-hearthfire')).toBe(
      true,
    );
  });

  it('always opens the always-open pages, whatever was collected', () => {
    const all = unlocked(GAME_DATA.resources.map((r) => r.id));
    expect(all.size).toBe(PAGES.length);
    for (const key of RECIPE_BOOK.alwaysOpen) expect(all.has(key as never)).toBe(true);
  });

  it('can take its own always-open list', () => {
    expect([...unlockedPageKeys(PAGES, new Set(), [])]).toEqual([]);
  });

  it('opens everything the tutorial and a first session make, from a fresh account', () => {
    // The tutorial builds a Hearthfire and a habitat from Sprout's bag and
    // what it gathers, and befriends with the bag's Heart Charms.
    const steps = TUTORIAL_STEPS.map((s) => s.id);
    expect(steps).toContain('hearthfire');
    expect(steps).toContain('habitat');
    const open = unlocked([]);
    expect(open.has('building:hearthfire')).toBe(true);
    for (const habitat of GAME_DATA.buildings.filter((b) => b.kind === 'habitat')) {
      expect(open.has(buildingPageKey(habitat.id))).toBe(true);
    }
    // The bag holds Heart Charms; making more never waits on a page.
    expect(TUTORIAL_SETUP.bag['heart-charm']).toBeGreaterThan(0);
    expect(open.has('recipe:heart-charm')).toBe(true);
  });
});

describe('canMakeNow', () => {
  it('is true once the bag holds every ingredient', () => {
    const charm = page('recipe:heart-charm');
    expect(canMakeNow(charm, { timber: 2, treats: 1 })).toBe(true);
    expect(canMakeNow(charm, { timber: 1, treats: 5 })).toBe(false);
    expect(canMakeNow(charm, {})).toBe(false);
  });
});

describe('whereToFind', () => {
  it('knows public facts for every resource', () => {
    for (const r of GAME_DATA.resources) {
      const where = whereToFind(r.id);
      expect(where.season, r.id).toBe(r.season ?? null);
      const found =
        where.terrains.length > 0 ||
        where.homeRing ||
        where.bonusFrom.length > 0 ||
        where.madeBy.length > 0;
      // Heartdust comes from rescues and seasonal extras from events: no node, bonus or recipe yet.
      const elsewhere = ['heartdust', 'turkey-feathers', 'presents', 'fireworks'];
      expect(found, r.id).toBe(!elsewhere.includes(r.id));
    }
  });

  it('points at terrains, home rings, bonuses and recipes', () => {
    expect(whereToFind('timber')).toEqual({
      terrains: ['forest', 'junipers-gap'],
      gatheredOn: ['forest'],
      homeRing: true,
      bonusFrom: [],
      madeBy: [],
      season: null,
    });
    expect(whereToFind('witch-dust')).toEqual({
      terrains: [],
      gatheredOn: [],
      homeRing: false,
      bonusFrom: ['emberwood', 'pumpkins'],
      madeBy: [],
      season: 'halloween',
    });
    expect(whereToFind('treats')).toMatchObject({
      homeRing: true,
      gatheredOn: [],
      madeBy: ['cook-treats', 'pumpkin-treats'],
    });
    // The nesting economy (#238): a terrain's primary resource is its land's.
    expect(whereToFind('ice')).toMatchObject({
      terrains: [],
      gatheredOn: ['mountains'],
      madeBy: ['freeze-water'],
    });
    expect(whereToFind('greens')).toMatchObject({
      terrains: ['forest'],
      gatheredOn: ['meadow'],
    });
    expect(whereToFind('jack-o-lantern-hearthfire')).toMatchObject({
      madeBy: ['jack-o-lantern-hearthfire'],
    });
    expect(whereToFind('pumpkins')).toMatchObject({
      terrains: ['pumpkin-fields'],
      season: 'halloween',
    });
  });

  it('knows nothing about made-up items', () => {
    expect(whereToFind('golden-ticket')).toEqual({
      terrains: [],
      gatheredOn: [],
      homeRing: false,
      bonusFrom: [],
      madeBy: [],
      season: null,
    });
  });
});
