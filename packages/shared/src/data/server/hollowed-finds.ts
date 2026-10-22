import { COMMUNITY_RULES } from '../communities.js';
import type { ExploreFindTable } from '../../schemas/data/explore-finds.js';
import type { FoundSetDropTable } from '../../schemas/data/found-set-drops.js';
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

/**
 * The Rekindled set's pieces and finds by weight (×10, so the epic can be
 * the rarest): every Rekindled table shares them, so the ladder can't drift
 * between places; only the chance differs.
 */
const REKINDLED_ENTRIES = [
  { weight: 30, clothing: 'lantern-glow-cap' }, // TUNE: every weight
  { weight: 30, clothing: 'ember-patch-trousers' },
  { weight: 20, clothing: 'ember-patch-jacket' },
  { weight: 20, clothing: 'lantern-glow-boots' },
  { weight: 10, clothing: 'joy-lantern-charm' },
  { weight: 30, items: { 'joy-ember': 1 } },
  { weight: 30, items: { 'heart-petals': 1 } },
] as const satisfies readonly FoundSetDropTable['entries'][number][];

/**
 * Where the Rekindled set drops (#306 PR 5, plan "Build split"): only in
 * Hollowed places. Secret, with the find tables (rule 6). PR 2a's village
 * searches roll `village` now; the memory puzzles (2b), the cellars (2c) and
 * the far Hollow (PR 6) roll their own place through the server's
 * `rekindledDrop`, so none of them edits these tables. Odds on top of the
 * search's ordinary find. `pnpm sim:hollowed` reports how long a casual kid
 * takes to find the whole set.
 */
export const REKINDLED_DROPS: FoundSetDropTable[] = [
  { set: 'rekindled', place: 'village', chance: 10, entries: [...REKINDLED_ENTRIES] }, // TUNE:
  // A solved puzzle is rare and a big moment: it often gives something.
  { set: 'rekindled', place: 'puzzle', chance: 50, entries: [...REKINDLED_ENTRIES] }, // TUNE:
  // Cellars have the better loot (plan Q5): about 3× a village search.
  { set: 'rekindled', place: 'cellar', chance: 30, entries: [...REKINDLED_ENTRIES] }, // TUNE:
  // Plan Q7: Rekindled pieces at 2× the village odds.
  { set: 'rekindled', place: 'far-hollow', chance: 20, entries: [...REKINDLED_ENTRIES] }, // TUNE:
];
