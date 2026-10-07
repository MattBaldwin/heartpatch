import { describe, expect, it } from 'vitest';
import { RECIPES } from '../data/recipes.js';
import { RESOURCES } from '../data/resources.js';
import { TUTORIAL_OVERRIDES } from '../data/tutorial/overrides.js';
import {
  canGather,
  craftSecondsFor,
  gatherSeconds,
  gatherYield,
  inSeason,
  needMoreText,
  shortfall,
} from './index.js';

const resource = (id: string) => {
  const found = RESOURCES.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};
const HALLOWEEN = new Set(['halloween']);
const NONE = new Set<string>();

describe('gathering rules', () => {
  it('only gathers Pumpkins in the Halloween window', () => {
    expect(canGather(resource('pumpkins'), HALLOWEEN)).toBe(true);
    expect(canGather(resource('pumpkins'), NONE)).toBe(false);
    expect(canGather(resource('timber'), NONE)).toBe(true);
  });

  it('never gathers things without gather settings (crafted items, Heartdust)', () => {
    expect(canGather(resource('heart-charm'), HALLOWEEN)).toBe(false);
    expect(canGather(resource('heartdust'), HALLOWEEN)).toBe(false);
  });

  it('adds Witch Dust to Emberwood gathers only around Halloween', () => {
    const emberwood = resource('emberwood');
    expect(gatherYield(emberwood, RESOURCES, HALLOWEEN)).toEqual({
      emberwood: emberwood.gather!.quantity,
      'witch-dust': 1,
    });
    expect(gatherYield(emberwood, RESOURCES, NONE)).toEqual({
      emberwood: emberwood.gather!.quantity,
    });
  });

  it('yields nothing for a resource with no gather settings', () => {
    expect(gatherYield(resource('heart-charm'), RESOURCES, HALLOWEEN)).toEqual({});
  });

  it('uses the tutorial quick timer when there is one', () => {
    expect(gatherSeconds(resource('timber'), null)).toBe(resource('timber').gather!.seconds);
    expect(gatherSeconds(resource('timber'), TUTORIAL_OVERRIDES)).toBe(
      TUTORIAL_OVERRIDES.gatherSeconds,
    );
  });

  it('makes a craft quicker with the right squishy on the team (#238)', () => {
    const freeze = RECIPES.find((r) => r.id === 'freeze-water')!;
    expect(freeze.fasterWith).toEqual({ element: 'frost', percent: 50 });
    expect(craftSecondsFor(freeze, [])).toBe(freeze.craftSeconds);
    expect(craftSecondsFor(freeze, ['fire', 'water'])).toBe(freeze.craftSeconds);
    expect(craftSecondsFor(freeze, ['fire', 'frost'])).toBe(freeze.craftSeconds / 2);
    // No speed-up on the recipe: always its own time.
    const charm = RECIPES.find((r) => r.id === 'heart-charm')!;
    expect(craftSecondsFor(charm, ['frost'])).toBe(charm.craftSeconds);
    // Rounded up, so a speed-up never makes a craft instant.
    expect(
      craftSecondsFor({ craftSeconds: 7, fasterWith: { element: 'frost', percent: 50 } }, [
        'frost',
      ]),
    ).toBe(4);
    expect(
      craftSecondsFor({ craftSeconds: 1, fasterWith: { element: 'frost', percent: 90 } }, [
        'frost',
      ]),
    ).toBe(1);
  });

  it('only unlocks the Jack-o-Lantern recipe in season', () => {
    const recipe = RECIPES.find((r) => r.id === 'jack-o-lantern-hearthfire')!;
    expect(inSeason(recipe, HALLOWEEN)).toBe(true);
    expect(inSeason(recipe, NONE)).toBe(false);
    expect(
      inSeason(
        RECIPES.find((r) => r.id === 'heart-charm')!,
        NONE,
      ),
    ).toBe(true);
  });

  it('says what is missing for a cost', () => {
    expect(shortfall({ timber: 1 }, { timber: 2, treats: 1 })).toEqual({ timber: 1, treats: 1 });
    expect(shortfall({ timber: 5, treats: 1 }, { timber: 2, treats: 1 })).toEqual({});
  });

  it('says what is missing the same way everywhere', () => {
    expect(needMoreText({ timber: 1 }, RESOURCES)).toBe('You need 1 more Timber first!');
    expect(needMoreText({ timber: 2, treats: 1, stone: 3 }, RESOURCES)).toBe(
      'You need 2 more Timber, 1 more Treats and 3 more Stone first!',
    );
  });
});
