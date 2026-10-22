import type { Rng } from '../../rng/index.js';

/**
 * What fixing a grey village tile's Relight puzzle gives (#306 PR 2b, plan
 * Q5: "the server rolls a lore page or a Rekindled recipe page"). Secret
 * (CLAUDE.md rule 6), like the find tables.
 */
export interface PuzzleRewards {
  /** Lore pages a puzzle can give (`LORE_PAGES` ids, each found through `explore.puzzled`). */
  readonly lorePages: readonly string[];
  /** Once every page is found (and no recipe is left): a small thank-you, item id → how many. */
  readonly fallback: Readonly<Record<string, number>>;
}

export const PUZZLE_REWARDS: PuzzleRewards = {
  lorePages: ['the-market-day-tune', 'the-painted-wall', 'keep-the-lanterns-lit'],
  fallback: { heartdust: 1 }, // TUNE: one piece's joy, so a fixed thing is never for nothing
};

/** A puzzle's reward: one page (lore or recipe), else the fallback items. */
export type PuzzleReward =
  | { readonly kind: 'lore'; readonly id: string }
  | { readonly kind: 'recipe'; readonly id: string }
  | { readonly kind: 'items'; readonly items: Readonly<Record<string, number>> };

/**
 * Rolls a puzzle's reward: a page the kid hasn't found yet, lore and recipe
 * pages alike, else the fallback. `recipes` are the Rekindled recipe pages
 * still sealed for the kid (#306 PR 5 passes them; none until it lands).
 */
export function rollPuzzleReward(
  rewards: PuzzleRewards,
  have: { readonly foundLore: ReadonlySet<string>; readonly recipes: readonly string[] },
  rng: Rng,
): PuzzleReward {
  const pages: PuzzleReward[] = [
    ...rewards.lorePages
      .filter((id) => !have.foundLore.has(id))
      .map((id) => ({ kind: 'lore' as const, id })),
    ...have.recipes.map((id) => ({ kind: 'recipe' as const, id })),
  ];
  if (pages.length === 0) return { kind: 'items', items: rewards.fallback };
  return rng.pick(pages);
}
