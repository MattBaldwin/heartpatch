import {
  isKeeperClothing,
  sortWearing,
  type Boutique,
  type BoutiqueItem,
  type ClothingItem,
} from '@heartpatch/shared';

// Pure helpers for the Boutique screen (design doc §23, #45): which racks to
// show, what each piece's button says, and what the Keeper tries on. The
// server prices and checks everything (CLAUDE.md rule 1); these only draw.

// Player-facing text (style guide §2, §6, §8: earned coins, no real-money words).
export const BOUTIQUE_TEXT = {
  open: 'Boutique',
  title: 'Boutique',
  subtitle: 'Tap something to try it on!',
  coins: (n: number) => `${String(n)} Patch Coins`,
  today: 'Today’s rack',
  season: (name: string) => `${name} rack`,
  restock: 'New things on the racks tomorrow!',
  owned: 'Got it!',
  price: (n: number) => `${String(n)} coins`,
  need: (n: number) => `${String(n)} more`,
  confirm: (name: string, price: number) => `Get ${name} for ${String(price)} Patch Coins?`,
  left: (n: number) => `You’ll have ${String(n)} left.`,
  buy: 'Yes please!',
  notNow: 'Not now',
  notEnough: 'Not enough Patch Coins yet!',
  earnHint: 'Win battles, make friends and care for your squishies to earn more.',
  okay: 'Okay',
  bought: (name: string) => `Yay! ${name} is in your wardrobe.`,
  forSquishies: 'For your squishies',
  back: 'Back',
  loading: 'Opening the Boutique…',
  loadFailed: 'We couldn’t open the Boutique. Check your connection and try again!',
  retry: 'Try again',
  devGrant: 'Get coins (dev)',
} as const;

/** What a piece's button offers, for the player's balance. */
export type BuyState = { kind: 'owned' } | { kind: 'buy' } | { kind: 'short'; need: number };

export function buyState(item: BoutiqueItem, balance: number): BuyState {
  if (item.owned) return { kind: 'owned' };
  if (balance < item.price) return { kind: 'short', need: item.price - balance };
  return { kind: 'buy' };
}

/** One rack to draw: today's, then one per season that's on. */
export interface Rack {
  id: string;
  title: string;
  items: BoutiqueItem[];
}

export function racksOf(boutique: Boutique, seasonName: (id: string) => string): Rack[] {
  return [
    { id: 'daily', title: BOUTIQUE_TEXT.today, items: boutique.daily },
    ...boutique.seasonal.map((rack) => ({
      id: rack.seasonId,
      title: BOUTIQUE_TEXT.season(seasonName(rack.seasonId)),
      items: rack.items,
    })),
  ].filter((rack) => rack.items.length > 0);
}

/**
 * What the Keeper wears to try `itemId` on: the outfit with the piece in its
 * slot instead of whatever was there (a costume goes over everything, as it
 * does in the wardrobe). Squishy accessories don't go on the Keeper, so the
 * outfit stays as it is. Nothing is sent: it's only the preview.
 */
export function previewWearing(
  wearing: readonly string[],
  itemId: string | null,
  catalog: ReadonlyMap<string, ClothingItem>,
): string[] {
  const item = itemId === null ? undefined : catalog.get(itemId);
  if (!item || !isKeeperClothing(item) || wearing.includes(item.id)) return [...wearing];
  const kept = wearing.filter((id) => catalog.get(id)?.slot !== item.slot);
  return sortWearing([...kept, item.id], catalog);
}
