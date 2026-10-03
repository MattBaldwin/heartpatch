import { z } from 'zod';
import { CLOTHING_RARITIES, type ClothingItem } from './clothing.js';
import { formatDataIssues } from './issues.js';

// Patch Coins and the Boutique (design doc §23; issue #45). Coins are earned
// in play and never bought (CLAUDE.md rule 9). They belong to the account
// (DECISIONS F), with daily earning caps so extra patches aren't a coin farm.
// Care's coins and cap stay in the care rules (`CARE_RULES`, decision G):
// care computes them and the coins module pays out exactly that.

const coins = z.number().int().min(0).max(1000);

/**
 * What can change a Patch Coin balance, stored as `coin_ledger.source`. Each
 * `(source, ref_id)` changes it at most once, so a retried grant pays once.
 * - `battle`: a battle won (`ref_id` the battle).
 * - `capture`: a squishy befriended or a tile claimed (`ref_id` the battle).
 * - `care`: a care action's coins (`ref_id` the `care_log` row).
 * - `milestone`: a milestone's reward (#44).
 * - `boutique`: a purchase (negative; `ref_id` the piece bought).
 * - `dev-grant`: dev and test builds only.
 */
export const CoinSourceSchema = z.enum([
  'battle',
  'capture',
  'care',
  'milestone',
  'boutique',
  'dev-grant',
]);
export type CoinSource = z.infer<typeof CoinSourceSchema>;

export const CoinRulesSchema = z.strictObject({
  /** Coins for a battle won, by battle kind (Gentle's share scales it, like XP). */
  battleWin: z.strictObject({ wild: coins, tile: coins, 'rival-tile': coins, rescue: coins }),
  /**
   * Coins for befriending a wild squishy, and for claiming a tile (neutral or
   * a rival's; Gentle's share scales it, like found clothing).
   */
  capture: z.strictObject({ wild: coins, tile: coins }),
  /**
   * The most an account earns from each source per account day (its own time
   * zone), across every patch. Care's cap is `CARE_RULES.dailyCoinCap`.
   */
  dailyCaps: z.strictObject({
    battle: z.number().int().min(1).max(10_000),
    capture: z.number().int().min(1).max(10_000),
  }),
});
export type CoinRules = z.infer<typeof CoinRulesSchema>;

export const BoutiqueRulesSchema = z
  .strictObject({
    /** Pieces on today's rack (everyday clothing), new every account day. */
    dailySlots: z.number().int().min(1).max(12),
    /** Pieces on each seasonal rack, from that season's clothing, while it's on. */
    seasonalSlots: z.number().int().min(1).max(12),
    /** Every `boutiquePrice` sits in this range. */
    minPrice: z.number().int().min(1),
    maxPrice: z.number().int().min(1),
  })
  .superRefine((rules, ctx) => {
    if (rules.maxPrice < rules.minPrice) {
      ctx.addIssue({ code: 'custom', path: ['maxPrice'], message: 'below minPrice' });
    }
  });
export type BoutiqueRules = z.infer<typeof BoutiqueRulesSchema>;

/** Readable problems with the coin rules, or `[]` if they're all good. */
export function checkCoinRules(input: unknown): string[] {
  const result = CoinRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/**
 * Readable problems with the Boutique rules and the catalog's prices, or
 * `[]`: every price in range, a rarer piece never cheaper than a commoner
 * one, and enough everyday pieces to fill today's rack.
 */
export function checkBoutiqueData(input: unknown, catalog: readonly ClothingItem[]): string[] {
  const result = BoutiqueRulesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const rules = result.data;
  const problems: string[] = [];
  const priced = catalog.filter((item) => item.boutiquePrice !== undefined);
  for (const item of priced) {
    const price = item.boutiquePrice ?? 0;
    if (price < rules.minPrice || price > rules.maxPrice) {
      problems.push(
        `clothing ${item.id}: boutiquePrice ${String(price)} is outside ${String(rules.minPrice)}–${String(rules.maxPrice)}`,
      );
    }
  }
  const rank = (item: ClothingItem) => CLOTHING_RARITIES.indexOf(item.rarity);
  for (const a of priced) {
    for (const b of priced) {
      if (rank(a) < rank(b) && (a.boutiquePrice ?? 0) > (b.boutiquePrice ?? 0)) {
        problems.push(
          `clothing ${b.id}: a ${b.rarity} piece costs less than ${a.id} (${a.rarity})`,
        );
      }
    }
  }
  const everyday = priced.filter((item) => item.season === undefined).length;
  if (everyday < rules.dailySlots) {
    problems.push(
      `boutique: ${String(everyday)} everyday pieces can't fill ${String(rules.dailySlots)} daily slots`,
    );
  }
  return problems;
}
