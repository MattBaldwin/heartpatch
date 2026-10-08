import { describe, expect, it } from 'vitest';
import { scanPlayerFacingText } from '../../data/avoided-words.js';
import { CLOTHING, CLOTHING_BY_ID, STARTER_CLOTHING } from '../../data/clothing.js';
import { SEASONS } from '../../data/seasons.js';
import {
  checkClothingData,
  CLOTHING_RARITIES,
  ClothingItemSchema,
  isKeeperClothing,
  SQUISHY_SLOT,
  sortWearing,
  wearingProblem,
  type ClothingItem,
} from './clothing.js';
import { WARDROBE_SLOTS } from './keepers.js';

const SEASON_IDS = SEASONS.map((s) => s.id);
const copy = (): ClothingItem[] => structuredClone(CLOTHING);
const byId = (id: string): ClothingItem => {
  const item = CLOTHING_BY_ID.get(id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
};

describe('the clothing catalog', () => {
  it('passes its checks', () => {
    expect(checkClothingData(CLOTHING, SEASON_IDS)).toEqual([]);
  });

  it('has an everyday set across all 8 slots, a Halloween set and squishy accessories', () => {
    const keeper = CLOTHING.filter(isKeeperClothing);
    const everyday = keeper.filter((i) => i.season === undefined);
    const halloween = keeper.filter((i) => i.season === 'halloween');
    expect(everyday.length).toBeGreaterThanOrEqual(20);
    expect(halloween.length).toBeGreaterThanOrEqual(12);
    for (const slot of WARDROBE_SLOTS) {
      expect(everyday.some((i) => i.slot === slot)).toBe(true);
      expect(halloween.some((i) => i.slot === slot)).toBe(true);
    }
    const names = halloween.map((i) => i.name);
    for (const name of ['Pumpkin Hood', 'Ghost Cape', 'Witch Hat', 'Squishy Onesie']) {
      expect(names).toContain(name);
    }
    const accessories = CLOTHING.filter((i) => i.slot === SQUISHY_SLOT);
    expect(accessories.map((i) => i.visual.anchor)).toContain('crown');
    expect(accessories.map((i) => i.visual.anchor)).toContain('neck');
    expect(accessories.some((i) => i.season === 'halloween')).toBe(true);
  });

  it('gives every account a starter outfit for every slot but costume, and a squishy bow', () => {
    const slots = STARTER_CLOTHING.map((id) => byId(id).slot);
    expect(slots.toSorted()).toEqual(
      [...WARDROBE_SLOTS.filter((s) => s !== 'costume'), SQUISHY_SLOT].toSorted(),
    );
    for (const id of STARTER_CLOTHING) expect(byId(id).tradable).toBe(false);
  });

  it('is cosmetic only: no item carries stats', () => {
    const withStats = { ...byId('witch-hat'), stats: { attack: 1 } };
    expect(ClothingItemSchema.safeParse(withStats).success).toBe(false);
  });

  it('ranks clothing from Common to Mythic, never Secret (#261)', () => {
    expect(CLOTHING_RARITIES).toEqual([
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
      'mythic',
    ]);
    expect(
      ClothingItemSchema.safeParse({ ...byId('cloud-onesie'), rarity: 'mythic' }).success,
    ).toBe(true);
    expect(
      ClothingItemSchema.safeParse({ ...byId('cloud-onesie'), rarity: 'secret' }).success,
    ).toBe(false);
  });

  it('uses every rarity, so the filter always has something to show', () => {
    const rarities = new Set(CLOTHING.map((i) => i.rarity));
    expect([...rarities].toSorted()).toEqual(
      ['common', 'epic', 'legendary', 'rare', 'uncommon'].toSorted(),
    );
  });

  it('has no avoided words in names or descriptions (style guide §9)', () => {
    expect(scanPlayerFacingText({ CLOTHING }, 'clothing')).toEqual([]);
  });

  it('reports each broken rule by item', () => {
    const items = copy();
    items[0]!.season = 'spring';
    items[1]!.tradable = true; // a starter
    delete items[8]!.boutiquePrice; // sold, with no price
    items[9]!.sources = ['found']; // priced, not sold
    items[10]!.visual.anchor = 'crown'; // a Keeper item
    items.push({ ...items[2]! });
    expect(checkClothingData(items, SEASON_IDS)).toEqual([
      'clothing["cozy-sweater"].id: duplicate id "cozy-sweater"',
      'clothing["sunny-cap"].season: unknown season "spring"',
      'clothing["sunny-cap"].sources: seasonal items are only got in season, so never starters',
      'clothing["daisy-clip"].tradable: starter, tutorial and milestone items stay with the account',
      'clothing["flower-crown"].boutiquePrice: Boutique items need a price, and only they have one',
      'clothing["starry-crown"].boutiquePrice: Boutique items need a price, and only they have one',
      'clothing["heart-clip"].visual: squishy accessories need an anchor, and only they have one',
    ]);
  });

  it('needs starters for Keepers and squishies, so the wardrobe is never empty', () => {
    const items = copy().map((i) => {
      const found = { ...i, sources: ['found' as const], tradable: true };
      delete found.boutiquePrice;
      return found;
    });
    expect(checkClothingData(items, SEASON_IDS)).toEqual([
      'clothing: no starter clothing for Keepers',
      'clothing: no starter accessory for squishies',
    ]);
  });
});

describe('wearingProblem', () => {
  it('accepts one item per slot, a costume included', () => {
    expect(wearingProblem(['witch-hat', 'ghost-cape', 'ghost-sheet'], CLOTHING_BY_ID)).toBeNull();
    expect(wearingProblem([], CLOTHING_BY_ID)).toBeNull();
  });

  it('refuses unknown ids, squishy accessories, repeats and two in one slot', () => {
    expect(wearingProblem(['crown-of-doom'], CLOTHING_BY_ID)).toEqual({
      kind: 'unknown',
      itemId: 'crown-of-doom',
    });
    expect(wearingProblem(['tiny-bow'], CLOTHING_BY_ID)).toEqual({
      kind: 'not-keeper',
      itemId: 'tiny-bow',
    });
    expect(wearingProblem(['witch-hat', 'witch-hat'], CLOTHING_BY_ID)).toEqual({
      kind: 'twice',
      itemId: 'witch-hat',
    });
    expect(wearingProblem(['witch-hat', 'sunny-cap'], CLOTHING_BY_ID)).toEqual({
      kind: 'same-slot',
      slot: 'hat',
    });
  });
});

describe('sortWearing', () => {
  it('puts items in slot order, so equal outfits compare equal', () => {
    expect(sortWearing(['ghost-sheet', 'puddle-boots', 'witch-hat'], CLOTHING_BY_ID)).toEqual([
      'witch-hat',
      'puddle-boots',
      'ghost-sheet',
    ]);
  });
});
