import { COMMUNITY_RULES } from '../communities.js';
import type { ExploreFindTable } from '../../schemas/data/explore-finds.js';
import { CELLAR_RULES } from './cellar.js';
import { EXPLORE_FINDS } from './explore-finds.js';

type Find = ExploreFindTable['finds'][number];

/**
 * A table with the finds `picked` says hold `multiplier` times their share.
 * Exact and in whole weights: with `h` the weight of the picked finds out of
 * `t`, they're scaled by `m(t - h)` and the rest by `t - m·h`, so their share
 * is `m·h / t` (a table where that reaches 1 keeps only the picked finds).
 */
function scaleShare(
  table: ExploreFindTable,
  multiplier: number,
  picked: (f: Find) => boolean,
): ExploreFindTable {
  const t = table.finds.reduce((a, f) => a + f.weight, 0);
  const h = table.finds.filter(picked).reduce((a, f) => a + f.weight, 0);
  if (h === 0 || multiplier === 1) return table;
  if (multiplier * h >= t) return { ...table, finds: table.finds.filter(picked) };
  const pickedScale = multiplier * (t - h);
  const restScale = t - multiplier * h;
  return {
    ...table,
    finds: table.finds.map((f) => ({
      ...f,
      weight: f.weight * (picked(f) ? pickedScale : restScale),
    })),
  };
}

/** Does this find hold some of `item`? */
const holdsItem = (item: string) => (f: Find) => (f.items?.[item] ?? 0) > 0;

/**
 * What a search on a grey village tile finds (#306 2a, owner decision 1):
 * the ordinary explore tables with the joy (Heartdust) found
 * `heartdustFindMultiplier` times as often. Secret, like the tables it's
 * made from (CLAUDE.md rule 6).
 */
export function hollowedFinds(
  tables: readonly ExploreFindTable[],
  multiplier: number,
  joy: string,
): ExploreFindTable[] {
  return tables.map((table) => scaleShare(table, multiplier, holdsItem(joy)));
}

/**
 * What a spot in a hidden cellar finds (#306 PR 2c): a grey village tile's
 * tables with the empty finds taken out (a cellar spot always holds
 * something) and the rare ones, the joy and lore pages, `multiplier` times
 * as likely. A table that held nothing else keeps its finds as they were.
 */
export function cellarFinds(
  tables: readonly ExploreFindTable[],
  multiplier: number,
  joy: string,
): ExploreFindTable[] {
  const rare = (f: Find) => holdsItem(joy)(f) || f.lore !== undefined;
  return tables.map((table) => {
    const full = table.finds.filter((f) => f.items !== undefined || f.lore !== undefined);
    return scaleShare(full.length > 0 ? { ...table, finds: full } : table, multiplier, rare);
  });
}

export const HOLLOWED_FINDS: ExploreFindTable[] = hollowedFinds(
  EXPLORE_FINDS,
  COMMUNITY_RULES.heartdustFindMultiplier,
  COMMUNITY_RULES.joyResource,
);

/** A hidden cellar's finds (#306 PR 2c): better loot, rare finds `rareFindMultiplier` times as often. */
export const CELLAR_FINDS: ExploreFindTable[] = cellarFinds(
  HOLLOWED_FINDS,
  CELLAR_RULES.rareFindMultiplier,
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
