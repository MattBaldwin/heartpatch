import { describe, expect, it } from 'vitest';
import { checkFoundSets, type FoundSet } from '../schemas/data/found-sets.js';
import { isPageUnlocked, recipeBookPages, recipePageKey } from '../recipe-book/index.js';
import { CLOTHING, CLOTHING_BY_ID } from './clothing.js';
import { findAvoidedWords } from './avoided-words.js';
import { FOUND_SETS, REKINDLED } from './found-sets.js';
import { BUILDINGS } from './buildings.js';
import { CARE_ACTIONS } from './care-actions.js';
import { MILESTONE_TRACKS } from './milestones.js';
import { RECIPES } from './recipes.js';
import { RESOURCES } from './resources.js';

const DATA = { clothing: CLOTHING, resources: RESOURCES };

describe('found sets (#306 PR 5)', () => {
  it('pass their check', () => {
    expect(checkFoundSets(FOUND_SETS, DATA)).toEqual([]);
  });

  it('report pieces that are bought, traded or seasonal, and finds that are gathered or traded', () => {
    const bad: FoundSet = {
      ...REKINDLED,
      id: 'bad',
      pieces: ['pom-pom-beanie', 'witch-hat', 'lantern-glow-cap', 'crown-of-doom'],
      finds: ['timber', 'heartdust'],
      title: { id: 'bad', name: 'Bad' },
    };
    expect(checkFoundSets([REKINDLED, bad], DATA)).toEqual([
      'sets["bad"].pieces[0]: "pom-pom-beanie" must be found only',
      'sets["bad"].pieces[0]: "pom-pom-beanie" stays with whoever found it: not tradable',
      'sets["bad"].pieces[1]: "witch-hat" must be found only',
      'sets["bad"].pieces[1]: "witch-hat" stays with whoever found it: not tradable',
      'sets["bad"].pieces[1]: "witch-hat" is found all year: no season',
      'sets["bad"].pieces[2]: "lantern-glow-cap" is in two sets',
      'sets["bad"].pieces[3]: unknown clothing "crown-of-doom"',
      'sets["bad"].finds[0]: "timber" is only ever found: gathered kind, no gather, not tradable',
      'sets["bad"].finds[1]: "heartdust" is only ever found: gathered kind, no gather, not tradable',
    ]);
  });

  it('dresses the Rekindled set head to toe, one piece a slot, with glowing trims', () => {
    const slots = REKINDLED.pieces.map((id) => CLOTHING_BY_ID.get(id)!.slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const id of REKINDLED.pieces) {
      const item = CLOTHING_BY_ID.get(id)!;
      expect(
        item.visual.pieces.some((p) => p.glow),
        id,
      ).toBe(true);
      expect(findAvoidedWords(`${item.name} ${item.description}`), id).toEqual([]);
    }
  });

  it('gives the Rekindler title for every piece, found (not traded)', () => {
    const track = MILESTONE_TRACKS.find((t) => t.id === 'set-rekindled')!;
    expect(track.tiers).toHaveLength(1);
    expect(track.tiers[0]).toMatchObject({
      threshold: REKINDLED.pieces.length,
      title: { id: 'rekindler', name: 'Rekindler' },
      goal: 'Find all 5 Rekindled pieces in the Hollows.',
    });
    expect(track.progress).toEqual({
      from: 'events',
      sources: [
        {
          eventType: 'clothing.found',
          where: [{ op: 'oneOf', field: 'itemId', values: REKINDLED.pieces }],
          player: 'userId',
          distinct: 'itemId',
        },
      ],
    });
  });

  it('seals the Joy Lantern and Heart Tea pages with a Rekindled find, so finding one opens them', () => {
    const pages = recipeBookPages();
    for (const [recipe, find] of [
      ['joy-lantern', 'joy-ember'],
      ['heart-tea', 'heart-petals'],
    ] as const) {
      expect(REKINDLED.finds).toContain(find);
      const page = pages.find((p) => p.key === recipePageKey(recipe))!;
      const rest = Object.keys(page.ingredients).filter((id) => id !== find);
      expect(isPageUnlocked(page, new Set(rest))).toBe(false);
      expect(isPageUnlocked(page, new Set([...rest, find]))).toBe(true);
    }
  });

  it('keeps the recipes to things the data already does: a fire and a care treat', () => {
    const lantern = BUILDINGS.find((b) => b.id === 'joy-lantern')!;
    const fire = BUILDINGS.find((b) => b.id === 'hearthfire')!;
    if (lantern.kind !== 'hearthfire' || fire.kind !== 'hearthfire') throw new Error('not fires');
    // A stronger fire: a tile further than a new Hearthfire, built from the crafted kit.
    expect(lantern.levels[0]!.safeRadius).toBe(fire.levels[0]!.safeRadius + 1);
    expect(lantern.levels[0]!.cost).toEqual({ 'joy-lantern': 1 });
    expect(RECIPES.find((r) => r.id === 'joy-lantern')!.output.resource).toBe('joy-lantern');
    // Heart Tea is a rare treat like the Heart Snack.
    const tea = CARE_ACTIONS.find((a) => a.id === 'heart-tea')!;
    expect(tea).toMatchObject({ cost: { 'heart-tea': 1 }, outsideDailyCare: true });
    expect(RECIPES.find((r) => r.id === 'heart-tea')!.output.resource).toBe('heart-tea');
  });
});
