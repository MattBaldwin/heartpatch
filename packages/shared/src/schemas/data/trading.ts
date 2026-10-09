import { z } from 'zod';
import { ClothingRaritySchema } from './clothing.js';
import { ContentIdSchema, RaritySchema } from './common.js';
import { formatDataIssues } from './issues.js';
import { isTradableResource, type Resource } from './resources.js';

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

const positive = z.number().positive();

/**
 * What things are worth on the fairness meter (#305, pulled forward from
 * #272; design doc §10). Values are plain numbers for the code only: players
 * see 1–5 hearts, never a number. Public: the meter is a display, and the
 * server can compute the same values for the #272 bonuses.
 */
export const TradeValuesSchema = z.strictObject({
  /** A level-1, first-stage, neutral-synergy squishy's worth, by its species' rarity. */
  squishyRarity: z.record(RaritySchema, positive),
  /** × by evolution stage: [first form, first evolution, …]; later stages use the last. */
  stage: z.array(positive).min(1),
  /** × (1 + levelStep × (level − 1)). */
  levelStep: z.number().min(0),
  /**
   * The rarity a species the viewer hasn't met is valued at (first stage,
   * neutral synergy), so the meter never gives a secret away (CLAUDE.md rule 6).
   */
  mysteryRarity: RaritySchema.exclude(['secret']),
  /** One of each tradable item, by id. */
  items: z.record(ContentIdSchema, positive),
  /** One clothing piece, by its rarity. */
  clothingRarity: z.record(ClothingRaritySchema, positive),
  /** The least a side is worth for 2, 3, 4 and 5 hearts (anything picked is at least 1). */
  hearts: z.tuple([positive, positive, positive, positive]),
  /** Even when the two sides are within this share of the bigger one (§10: ±15%). */
  evenBand: z.number().gt(0).lt(1),
  /** Lopsided when one side is worth at least this many times the other (#272). */
  lopsided: z.number().gt(1),
});
export type TradeValues = z.infer<typeof TradeValuesSchema>;

/**
 * Validates trade values against the game's items and returns readable
 * problems, or `[]`: every tradable item has a value, nothing else does, and
 * the heart steps go up.
 */
export function checkTradeValues(
  input: unknown,
  resources: readonly Pick<Resource, 'id' | 'tradable'>[],
): string[] {
  const result = TradeValuesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const values = result.data;
  const problems: string[] = [];
  const tradable = new Set(resources.filter(isTradableResource).map((r) => r.id));
  for (const id of tradable) {
    if (values.items[id] === undefined) problems.push(`items: ${id} has no value`);
  }
  for (const id of Object.keys(values.items)) {
    if (!tradable.has(id)) problems.push(`items: ${id} isn't a tradable item`);
  }
  if (values.hearts.some((v, i) => i > 0 && v <= (values.hearts[i - 1] ?? 0))) {
    problems.push('hearts: each step must be more than the one before');
  }
  return problems;
}
