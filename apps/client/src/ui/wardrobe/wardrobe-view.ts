import {
  CLOTHING,
  CLOTHING_BY_ID,
  CLOTHING_RARITIES,
  isKeeperClothing,
  SQUISHY_SLOT,
  sortWearing,
  WARDROBE_SLOTS,
  type ClothingItem,
  type ClothingRarity,
  type ClothingSlot,
  type OwnedClothing,
} from '@heartpatch/shared';

// What the wardrobe screen shows (design doc §23), as pure functions: the
// tabs, the filtered item list and what tapping an item does to the outfit.
// The server checks every outfit again (CLAUDE.md rule 1); this only decides
// what to try on.

/** A tab: one Keeper slot, or squishy accessories. */
export type WardrobeTab = ClothingSlot;
export const WARDROBE_TABS: readonly WardrobeTab[] = [...WARDROBE_SLOTS, SQUISHY_SLOT];

/** `all` or one rarity. */
export type RarityFilter = ClothingRarity | 'all';
/** `all`, then each rarity the catalog has a piece of, so no chip is always empty. */
export const RARITY_FILTERS: readonly RarityFilter[] = [
  'all',
  ...CLOTHING_RARITIES.filter((r) => CLOTHING.some((item) => item.rarity === r)),
];

const RARITY_ORDER = new Map(CLOTHING_RARITIES.map((r, i) => [r, i]));
const CATALOG_ORDER = new Map(CLOTHING.map((item, i) => [item.id, i]));

export interface ShownItem {
  readonly item: ClothingItem;
  readonly count: number;
}

/**
 * The player's items in one tab, at one rarity: commonest first, then in
 * catalog order. Ids this client doesn't know (a newer server) are skipped.
 */
export function shownItems(
  owned: readonly OwnedClothing[],
  tab: WardrobeTab,
  rarity: RarityFilter,
): ShownItem[] {
  return owned
    .flatMap(({ itemId, count }) => {
      const item = CLOTHING_BY_ID.get(itemId);
      return item ? [{ item, count }] : [];
    })
    .filter(({ item }) => item.slot === tab && (rarity === 'all' || item.rarity === rarity))
    .sort(
      (a, b) =>
        (RARITY_ORDER.get(a.item.rarity) ?? 0) - (RARITY_ORDER.get(b.item.rarity) ?? 0) ||
        (CATALOG_ORDER.get(a.item.id) ?? 0) - (CATALOG_ORDER.get(b.item.id) ?? 0),
    );
}

/** How many items the player has in each tab (badges on the tabs). */
export function tabCounts(owned: readonly OwnedClothing[]): Map<WardrobeTab, number> {
  const counts = new Map<WardrobeTab, number>();
  for (const { itemId } of owned) {
    const slot = CLOTHING_BY_ID.get(itemId)?.slot;
    if (slot) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return counts;
}

/**
 * Tapping a Keeper item: off if it's worn, else on, swapping out whatever was
 * in its slot. Returned in slot order, like the server stores it.
 */
export function toggleWorn(wearing: readonly string[], itemId: string): string[] {
  const item = CLOTHING_BY_ID.get(itemId);
  if (!item || !isKeeperClothing(item)) return [...wearing];
  if (wearing.includes(itemId)) return wearing.filter((id) => id !== itemId);
  const others = wearing.filter((id) => CLOTHING_BY_ID.get(id)?.slot !== item.slot);
  return sortWearing([...others, itemId], CLOTHING_BY_ID);
}

/** True when a costume is on, so the other worn items are hidden under it (#42's rule). */
export function hiddenByCostume(wearing: readonly string[], itemId: string): boolean {
  const slot = CLOTHING_BY_ID.get(itemId)?.slot;
  return (
    slot !== 'costume' &&
    wearing.includes(itemId) &&
    wearing.some((id) => CLOTHING_BY_ID.get(id)?.slot === 'costume')
  );
}

/** Two outfits are the same (both in slot order). */
export function sameOutfit(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
