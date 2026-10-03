import type { BoutiqueRules } from '../schemas/data/coins.js';
import type { ClothingItem } from '../schemas/data/clothing.js';
import type { LocalDate } from '../schemas/time.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';

// The Boutique's stock (design doc §23; issue #45): worked out from a seed
// and a date, never stored (CLAUDE.md rule 4), so every read on one day
// shows the same racks and the next day's are new. Pure and deterministic.

/** What the Boutique sells on one day: item ids, in catalog order. */
export interface BoutiqueStock {
  /** Today's rack: everyday pieces. */
  daily: string[];
  /** One rack per season that's on, in the order given; seasons with nothing to sell are left out. */
  seasonal: { seasonId: string; items: string[] }[];
}

export interface BoutiqueStockContext {
  /** Whose shop: the same seed and date always give the same racks. */
  seed: Seed;
  /** The shop's local date (`YYYY-MM-DD`): the racks change at its midnight. */
  date: LocalDate;
  /** Season ids on that date. Seasonal pieces only sell in their season (design doc §15). */
  seasons: readonly string[];
}

/** Up to `count` of `items`, picked without repeats, kept in their original order. */
function pickSome(items: readonly ClothingItem[], count: number, rng: Rng): string[] {
  const left = items.map((item, index) => ({ id: item.id, index }));
  const picked: { id: string; index: number }[] = [];
  // One uniform pick at a time from what's left (a partial shuffle).
  while (picked.length < count && left.length > 0) {
    picked.push(...left.splice(rng.int(0, left.length - 1), 1));
  }
  return picked.sort((a, b) => a.index - b.index).map((p) => p.id);
}

/**
 * The racks for one shop on one day: `dailySlots` everyday pieces with a
 * `boutiquePrice`, and `seasonalSlots` of each season's priced pieces while
 * it's on. Each rack rolls from its own child seed, so a new season's rack
 * never reshuffles today's.
 */
export function boutiqueStock(
  catalog: readonly ClothingItem[],
  context: BoutiqueStockContext,
  rules: Pick<BoutiqueRules, 'dailySlots' | 'seasonalSlots'>,
): BoutiqueStock {
  const priced = catalog.filter((item) => item.boutiquePrice !== undefined);
  const rack = (...labels: string[]) =>
    Rng.fromSeed(deriveSeed(context.seed, 'boutique', context.date, ...labels));
  const daily = pickSome(
    priced.filter((item) => item.season === undefined),
    rules.dailySlots,
    rack('daily'),
  );
  const seasonal = [...new Set(context.seasons)].flatMap((seasonId) => {
    const items = priced.filter((item) => item.season === seasonId);
    if (items.length === 0) return [];
    return [{ seasonId, items: pickSome(items, rules.seasonalSlots, rack('season', seasonId)) }];
  });
  return { daily, seasonal };
}

/** True if `itemId` is on any of the day's racks. */
export function inStock(stock: BoutiqueStock, itemId: string): boolean {
  return stock.daily.includes(itemId) || stock.seasonal.some((r) => r.items.includes(itemId));
}
