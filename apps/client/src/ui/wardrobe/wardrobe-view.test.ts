import { CLOTHING, CLOTHING_RARITIES, STARTER_CLOTHING } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  hiddenByCostume,
  RARITY_FILTERS,
  sameOutfit,
  shownItems,
  tabCounts,
  toggleWorn,
  WARDROBE_TABS,
} from './wardrobe-view.js';

const owned = [
  ...STARTER_CLOTHING.map((itemId) => ({ itemId, count: 1 })),
  { itemId: 'witch-hat', count: 2 },
  { itemId: 'starry-crown', count: 1 },
  { itemId: 'ghost-sheet', count: 1 },
  { itemId: 'from-the-future', count: 1 },
];

describe('shownItems', () => {
  it('shows one slot, commonest first, and skips ids this client does not know', () => {
    expect(shownItems(owned, 'hat', 'all').map((s) => [s.item.id, s.count])).toEqual([
      ['sunny-cap', 1],
      ['witch-hat', 2],
      ['starry-crown', 1],
    ]);
  });

  it('filters by rarity', () => {
    expect(shownItems(owned, 'hat', 'rare').map((s) => s.item.id)).toEqual(['starry-crown']);
    expect(shownItems(owned, 'hat', 'legendary')).toEqual([]);
  });

  it('offers a rarity chip only where the catalog has pieces, in ladder order', () => {
    const used = CLOTHING_RARITIES.filter((r) => CLOTHING.some((i) => i.rarity === r));
    expect(RARITY_FILTERS).toEqual(['all', ...used]);
    // Mythic (#261) waits for its first piece, so its chip is never always empty.
    expect(RARITY_FILTERS.includes('mythic')).toBe(CLOTHING.some((i) => i.rarity === 'mythic'));
  });

  it('has a tab per wardrobe slot plus squishy accessories', () => {
    expect(WARDROBE_TABS).toHaveLength(9);
    expect(shownItems(owned, 'squishy', 'all').map((s) => s.item.id)).toEqual(['tiny-bow']);
    expect(tabCounts(owned).get('hat')).toBe(3);
    expect(tabCounts(owned).get('costume')).toBe(1);
  });
});

describe('toggleWorn', () => {
  it('puts an item on, swapping out the one in its slot, in slot order', () => {
    expect(toggleWorn([], 'puddle-boots')).toEqual(['puddle-boots']);
    expect(toggleWorn(['puddle-boots'], 'sunny-cap')).toEqual(['sunny-cap', 'puddle-boots']);
    expect(toggleWorn(['sunny-cap', 'puddle-boots'], 'witch-hat')).toEqual([
      'witch-hat',
      'puddle-boots',
    ]);
  });

  it('takes a worn item off', () => {
    expect(toggleWorn(['witch-hat', 'puddle-boots'], 'witch-hat')).toEqual(['puddle-boots']);
  });

  it('ignores squishy accessories and unknown ids', () => {
    expect(toggleWorn(['witch-hat'], 'tiny-bow')).toEqual(['witch-hat']);
    expect(toggleWorn(['witch-hat'], 'nope')).toEqual(['witch-hat']);
  });
});

describe('costumes', () => {
  it('hide the other worn items, which stay on underneath', () => {
    const wearing = toggleWorn(['witch-hat', 'puddle-boots'], 'ghost-sheet');
    expect(wearing).toEqual(['witch-hat', 'puddle-boots', 'ghost-sheet']);
    expect(hiddenByCostume(wearing, 'witch-hat')).toBe(true);
    expect(hiddenByCostume(wearing, 'ghost-sheet')).toBe(false);
    expect(hiddenByCostume(['witch-hat'], 'witch-hat')).toBe(false);
  });
});

describe('sameOutfit', () => {
  it('compares outfits in slot order', () => {
    expect(sameOutfit(['witch-hat'], ['witch-hat'])).toBe(true);
    expect(sameOutfit(['witch-hat'], [])).toBe(false);
  });
});
