import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';

/**
 * What an advent present can hold (#37 1c, owner answer 3), and how often.
 * Secret (CLAUDE.md rule 6): the table lives in `data/server/advent.ts`, and
 * this schema, its check and the roll are exported only from
 * `@heartpatch/shared/server`. The client sees only which items a day *can*
 * hold (`adventContents`), never the weights.
 */

const weight = z.number().int().min(0);

/** One thing a present can hold: `min`–`max` of an item, picked by `weight`. */
export const AdventPoolEntrySchema = z.strictObject({
  itemId: ContentIdSchema,
  min: z.number().int().min(1).max(20),
  max: z.number().int().min(1).max(20),
  weight,
});
export type AdventPoolEntry = z.infer<typeof AdventPoolEntrySchema>;

/** How many different things a present holds, and from what. */
export const AdventPoolSchema = z.strictObject({
  picks: z.number().int().min(1).max(4),
  pool: z.array(AdventPoolEntrySchema).min(1),
});
export type AdventPool = z.infer<typeof AdventPoolSchema>;

export const AdventPresentsSchema = z.strictObject({
  /**
   * The secret parent of every advent seed (tech spec §8): a day's present is
   * `deriveSeed(seedSalt, 'advent', userId, day)`, so it's the same from any
   * patch and can't be worked out on the client.
   */
  seedSalt: z.string().min(8),
  /** A day's advent present (December 1–25). */
  daily: AdventPoolSchema,
  /** Added on top on these days of December (`1`–`25`), always: Fireworks on the 24th. */
  fixed: z.record(
    z.string().regex(/^(0?[1-9]|1\d|2[0-5])$/),
    z.record(ContentIdSchema, z.number().int().min(1)),
  ),
  /** A wrapped present to pass on comes too, on 1 claim in this many (1: every claim). */
  spareOneIn: z.number().int().min(1),
  /** A present opened from the bag (one gifted, or a spare kept). Never holds a present. */
  opening: AdventPoolSchema,
});
export type AdventPresents = z.infer<typeof AdventPresentsSchema>;

/** The wrapped present's item id. */
export const PRESENT_ITEM = 'presents';

/**
 * Validates the advent table and returns readable problems, or `[]`: every
 * item is a known resource, ranges run low to high, each pool can fill its
 * picks, and a present opened from the bag never holds another present (no
 * endless presents).
 */
export function checkAdventPresents(input: unknown, resourceIds: ReadonlySet<string>): string[] {
  const result = AdventPresentsSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const table = result.data;
  const problems: string[] = [];
  for (const key of ['daily', 'opening'] as const) {
    const { picks, pool } = table[key];
    if (pool.filter((e) => e.weight > 0).length < picks) {
      problems.push(`${key}: fewer items with a weight than its ${String(picks)} picks`);
    }
    const ids = new Set<string>();
    for (const e of pool) {
      if (!resourceIds.has(e.itemId)) problems.push(`${key}: unknown item "${e.itemId}"`);
      if (e.min > e.max) problems.push(`${key}.${e.itemId}: min is more than max`);
      if (ids.has(e.itemId)) problems.push(`${key}: "${e.itemId}" listed twice`);
      ids.add(e.itemId);
    }
  }
  if (table.opening.pool.some((e) => e.itemId === PRESENT_ITEM)) {
    problems.push('opening: a present must not hold another present');
  }
  if (table.daily.pool.some((e) => e.itemId === PRESENT_ITEM)) {
    problems.push('daily: the spare present comes from spareOneIn, not the pool');
  }
  for (const [day, items] of Object.entries(table.fixed)) {
    for (const id of Object.keys(items)) {
      if (!resourceIds.has(id)) problems.push(`fixed.${day}: unknown item "${id}"`);
    }
  }
  return problems;
}
