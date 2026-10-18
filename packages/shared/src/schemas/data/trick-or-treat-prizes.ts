import { z } from 'zod';
import { ClothingRaritySchema, SQUISHY_SLOT, type ClothingItem } from './clothing.js';
import { formatDataIssues } from './issues.js';
import type { TrickOrTreatPrizeKind } from '../trick-or-treat.js';

/**
 * What a trick-or-treat visit can give (#515), and how often. Secret
 * (CLAUDE.md rule 6): the table lives in `data/server/trick-or-treat-prizes.ts`,
 * and this schema, its check and the roll are exported only from
 * `@heartpatch/shared/server`.
 *
 * Costumes come from the clothing catalog: every item whose `sources` include
 * `trick-or-treat`, the squishy ones (`slot: 'squishy'`) for a squishy costume
 * and the rest for a Keeper costume. So a new costume joins the treats by its
 * catalog entry alone, with no change here.
 */

const weight = z.number().int().min(0);

/** One home's odds: how often each kind of treat comes up, and how much Heartdust. */
export const TrickOrTreatTableSchema = z.strictObject({
  heartdust: z.strictObject({
    weight,
    min: z.number().int().min(1).max(20),
    max: z.number().int().min(1).max(20),
  }),
  keeperCostume: z.strictObject({ weight }),
  squishyCostume: z.strictObject({ weight }),
});
export type TrickOrTreatTable = z.infer<typeof TrickOrTreatTableSchema>;

export const TrickOrTreatPrizesSchema = z.strictObject({
  /** A silly trick plays first on 1 visit in this many (it changes nothing). */
  trickOneIn: z.number().int().min(2),
  /** Any home. */
  plain: TrickOrTreatTableSchema,
  /** A home whose Keeper has a lit Jack-o'-Lantern Hearthfire tonight. */
  lantern: TrickOrTreatTableSchema,
  /** How often a costume of each rarity is picked against the others; 0 never. */
  rarityWeights: z.record(ClothingRaritySchema, weight),
});
export type TrickOrTreatPrizes = z.infer<typeof TrickOrTreatPrizesSchema>;

/** The costumes a visit can give of `kind`: catalog items with the `trick-or-treat` source. */
export function trickOrTreatCostumes(
  catalog: readonly ClothingItem[],
  kind: Exclude<TrickOrTreatPrizeKind, 'heartdust'>,
): ClothingItem[] {
  return catalog.filter(
    (item) =>
      item.sources.includes('trick-or-treat') &&
      (item.slot === SQUISHY_SLOT) === (kind === 'squishy-costume'),
  );
}

/**
 * Validates the prize table and returns readable problems, or `[]`: Heartdust
 * ranges run low to high, a lantern home is never worse than a plain one, and
 * every costume on offer is a Halloween piece that can actually come up.
 */
export function checkTrickOrTreatPrizes(
  input: unknown,
  catalog: readonly ClothingItem[],
): string[] {
  const result = TrickOrTreatPrizesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const prizes = result.data;
  const problems: string[] = [];
  for (const key of ['plain', 'lantern'] as const) {
    const table = prizes[key];
    if (table.heartdust.min > table.heartdust.max) {
      problems.push(`${key}.heartdust: min is more than max`);
    }
    if (table.heartdust.weight + table.keeperCostume.weight + table.squishyCostume.weight <= 0) {
      problems.push(`${key}: needs a positive total weight`);
    }
  }
  const { plain, lantern } = prizes;
  if (lantern.heartdust.min < plain.heartdust.min || lantern.heartdust.max < plain.heartdust.max) {
    problems.push('lantern.heartdust: less than a plain home gives');
  }
  const costumeShare = (t: TrickOrTreatTable) =>
    (t.keeperCostume.weight + t.squishyCostume.weight) /
    (t.heartdust.weight + t.keeperCostume.weight + t.squishyCostume.weight);
  if (costumeShare(lantern) < costumeShare(plain)) {
    problems.push('lantern: fewer costumes than a plain home');
  }
  for (const item of catalog.filter((i) => i.sources.includes('trick-or-treat'))) {
    if (item.season !== 'halloween') problems.push(`${item.id}: not a Halloween piece`);
    if (prizes.rarityWeights[item.rarity] <= 0) {
      problems.push(`rarityWeights: "${item.rarity}" is 0, so ${item.id} never comes up`);
    }
  }
  return problems;
}
