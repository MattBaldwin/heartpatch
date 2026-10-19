import { COMMUNITY_RULES } from '../communities.js';
import type { ExploreFindTable } from '../../schemas/data/explore-finds.js';
import { EXPLORE_FINDS } from './explore-finds.js';

/**
 * What a search on a grey village tile finds (#306 2a, owner decision 1):
 * the ordinary explore tables with the joy (Heartdust) found
 * `heartdustFindMultiplier` times as often. Secret, like the tables it's
 * made from (CLAUDE.md rule 6).
 *
 * Exact and in whole weights: with `h` the weight of the finds that hold the
 * joy out of `t`, those finds are scaled by `m(t - h)` and the rest by
 * `t - m·h`, so the joy's share is `m·h / t` (a table where that reaches 1
 * keeps only its joy finds).
 */
export function hollowedFinds(
  tables: readonly ExploreFindTable[],
  multiplier: number,
  joy: string,
): ExploreFindTable[] {
  return tables.map((table) => {
    const holds = (f: ExploreFindTable['finds'][number]) => (f.items?.[joy] ?? 0) > 0;
    const t = table.finds.reduce((a, f) => a + f.weight, 0);
    const h = table.finds.filter(holds).reduce((a, f) => a + f.weight, 0);
    if (h === 0 || multiplier === 1) return table;
    if (multiplier * h >= t) return { ...table, finds: table.finds.filter(holds) };
    const joyScale = multiplier * (t - h);
    const restScale = t - multiplier * h;
    return {
      ...table,
      finds: table.finds.map((f) => ({
        ...f,
        weight: f.weight * (holds(f) ? joyScale : restScale),
      })),
    };
  });
}

export const HOLLOWED_FINDS: ExploreFindTable[] = hollowedFinds(
  EXPLORE_FINDS,
  COMMUNITY_RULES.heartdustFindMultiplier,
  COMMUNITY_RULES.joyResource,
);

/**
 * A helper's thank-you (#306 PR 3, plan Q2): every piece that doesn't claim
 * its tile pays its placer this back at once, so helping a friend's village
 * is never for nothing. Item id → how many. Secret, with the find tables.
 */
export const HOLLOWED_HELPER_GIFT: Readonly<Record<string, number>> = {
  treats: 2, // TUNE: a small thank-you, about a third of a piece's Timber in value
};
