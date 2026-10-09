import { z } from 'zod';
import { formatDataIssues } from './issues.js';

const positiveInt = z.number().int().positive();

/**
 * Trades and gifts at trading posts (#271; owner decisions on #30). Public:
 * the post screen shows the limits, and the server enforces every one.
 */
export const TradeRulesSchema = z.strictObject({
  /** An open offer nobody answered goes back to its sender after this many days. */
  offerDays: positiveInt,
  /** Most squishies on one side of an offer. */
  squishiesPerSide: positiveInt,
  /** Most lines (squishies, stacks of an item, clothing pieces) on one side. */
  linesPerSide: positiveInt,
  /** Most open offers one player has sent on a patch at once. */
  openPerSender: positiveInt,
  /** Most open offers from one player to the same patch-mate at once. */
  openPerPair: positiveInt,
});
export type TradeRules = z.infer<typeof TradeRulesSchema>;

/** Validates trade rules and returns readable problems, or `[]`. */
export function checkTradeRules(input: unknown): string[] {
  const result = TradeRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
