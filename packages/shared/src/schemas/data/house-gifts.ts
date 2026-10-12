import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';

/**
 * The house's daily gift table (#381 PR H, plan §1c "Daily return reasons"):
 * once a day a resident at home leaves its Keeper a small resource gift,
 * rolled on the server from the secret map seed. Secret (CLAUDE.md rule 6,
 * DECISIONS "Found drops are server-side tables"): the table lives in
 * `data/server/house-gifts.ts`, and this schema and its check are exported
 * only from `@heartpatch/shared/server`.
 */

/** One thing a resident can leave as the day's gift, and how many (`min`..`max`). */
export const HouseGiftOptionSchema = z.strictObject({
  itemId: ContentIdSchema,
  min: z.number().int().min(1).max(99),
  max: z.number().int().min(1).max(99),
  /** How often it's picked against the others in its row. */
  weight: z.number().int().min(1),
});
export type HouseGiftOption = z.infer<typeof HouseGiftOptionSchema>;

/** The gifts a house from `fromLevel` up gives (the highest row at or under the level wins). */
export const HouseGiftRowSchema = z.strictObject({
  fromLevel: z.number().int().min(1),
  gifts: z.array(HouseGiftOptionSchema).min(1),
});
export type HouseGiftRow = z.infer<typeof HouseGiftRowSchema>;

export const HouseGiftTableSchema = z.strictObject({
  /** Gifts a day. One: `house_gifts` holds one row per Keeper per patch day. */
  perDay: z.literal(1),
  table: z.array(HouseGiftRowSchema).min(1),
});
export type HouseGiftTable = z.infer<typeof HouseGiftTableSchema>;

/** The content `checkHouseGifts` checks references against. */
export interface HouseGiftRefs {
  resources: readonly { id: string }[];
  /** The top house level (`HOUSE_DATA.levels.length`). */
  maxLevel: number;
}

/**
 * Validates the gift table and returns readable problems, or `[]`: rows
 * start at level 1 and climb, stay within the house's levels, name real
 * resources, and never give more at the low end than the high one.
 */
export function checkHouseGifts(input: unknown, refs: HouseGiftRefs): string[] {
  const result = HouseGiftTableSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const resources = new Set(refs.resources.map((r) => r.id));
  const problems: string[] = [];
  result.data.table.forEach((row, i) => {
    const at = `table[${String(i)}]`;
    const before = result.data.table[i - 1];
    if (i === 0 && row.fromLevel !== 1) problems.push(`${at}: the first row starts at level 1`);
    if (before && row.fromLevel <= before.fromLevel) {
      problems.push(`${at}: fromLevel should climb (${String(row.fromLevel)})`);
    }
    if (row.fromLevel > refs.maxLevel) problems.push(`${at}: no level ${String(row.fromLevel)}`);
    row.gifts.forEach((gift, j) => {
      const giftAt = `${at}.gifts[${String(j)}]`;
      if (!resources.has(gift.itemId))
        problems.push(`${giftAt}: unknown resource "${gift.itemId}"`);
      if (gift.min > gift.max) problems.push(`${giftAt}: min is more than max`);
    });
  });
  return problems;
}
