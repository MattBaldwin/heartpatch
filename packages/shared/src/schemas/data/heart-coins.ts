import { z } from 'zod';
import { formatDataIssues } from './issues.js';

// Heart Coins (#601): a second currency, per player per patch. Earned by
// playing on a patch and spent only there (building upkeep first), so they
// never move between patches, never buy clothes and never trade. Patch Coins
// stay the account's, for the Boutique (DECISIONS F, unchanged).

const coins = z.number().int().min(0).max(1000);
const cap = z.number().int().min(1).max(10_000);

/**
 * What can change a Heart Coin balance, stored as `heart_coin_ledger.source`.
 * Each `(source, ref_id)` changes it at most once, so a retried grant pays once.
 * - `battle`: a battle won on the patch (`ref_id` the battle).
 * - `capture`: a squishy befriended or a tile claimed (`ref_id` the battle).
 * - `care`: a full-value care action (`ref_id` the `care_log` row).
 * - `sell`: extras sold at a trading post (#601 PR 3; `ref_id` the sale).
 * - `upkeep`: a building's morning upkeep (negative; #601 PR 6).
 * - `dev-grant`: dev and test builds only.
 */
export const HeartCoinSourceSchema = z.enum([
  'battle',
  'capture',
  'care',
  'sell',
  'upkeep',
  'dev-grant',
]);
export type HeartCoinSource = z.infer<typeof HeartCoinSourceSchema>;

/** The sources with a daily cap, in the order the Heart Coins sheet shows them. */
export const HEART_COIN_CAPPED_SOURCES = ['battle', 'capture', 'care', 'sell'] as const;
export type HeartCoinCappedSource = (typeof HEART_COIN_CAPPED_SOURCES)[number];

export const HeartCoinRulesSchema = z.strictObject({
  /** Heart Coins for a battle won, by battle kind (Gentle's share scales it, like XP). */
  battleWin: z.strictObject({
    wild: coins,
    tile: coins,
    'rival-tile': coins,
    rescue: coins,
    journey: coins,
    friendly: coins,
  }),
  /**
   * Heart Coins for befriending a wild squishy, and for claiming a tile
   * (neutral or a rival's; Gentle's share scales it, like found clothing).
   */
  capture: z.strictObject({ wild: coins, tile: coins }),
  /** Heart Coins for a care action that counts in full (none for lesser ones or a Heart Snack). */
  care: z.strictObject({ perFullAction: coins }),
  /**
   * The most a player earns from each source per patch day (the patch's own
   * time zone), on that patch. Another patch has its own caps.
   */
  dailyCaps: z.strictObject({ battle: cap, capture: cap, care: cap, sell: cap }),
});
export type HeartCoinRules = z.infer<typeof HeartCoinRulesSchema>;

/** Readable problems with the Heart Coin rules, or `[]` if they're all good. */
export function checkHeartCoinRules(input: unknown): string[] {
  const result = HeartCoinRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/**
 * A care action's Heart Coins before the daily cap: only an action that
 * counts in full earns any, the same line Patch Coins draw (`careCoins`).
 */
export function careHeartCoins(
  gain: { full: boolean; counts: boolean },
  rules: Pick<HeartCoinRules, 'care'>,
): number {
  return gain.full && gain.counts ? rules.care.perFullAction : 0;
}
