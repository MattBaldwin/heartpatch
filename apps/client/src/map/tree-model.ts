import type { MapView, MapViewChristmas } from '@heartpatch/shared';

/*
 * The Patch Tree on the map (#37 2d): what the map draws and says from
 * `MapView.christmas.tree`, and how a live `tree.decorated` moves it. Pure,
 * so it's unit-tested without Babylon or the DOM. The server decides
 * everything (CLAUDE.md rule 1): which post, how many ornaments, and when the
 * star is lit. The words name the fun, never the players (kid safety), even
 * though the event says who gave whom.
 */

/** The tree as the map has it: absent until the server has planted it. */
export type PatchTree = NonNullable<MapViewChristmas['tree']>;

// Player-facing text (style guide §2, §6: cozy, short, kid-readable).
export const TREE_TEXT = {
  ornament: 'An ornament went up on the Patch Tree! 🎄',
  ornaments: (n: number) => `${String(n)} ornaments went up on the Patch Tree! 🎄`,
  toGo: (n: number) => `${String(n)} more to light the star!`,
  starLit: 'The star on the Patch Tree is lit! ⭐',
  hearts: (n: number) => `${String(n)} ${n === 1 ? 'heart' : 'hearts'} of warmth`,
} as const;

/**
 * Ornaments that light the star: mirrors `PATCH_TREE.starAt` (shared
 * data/patch-tree.ts), pinned equal by tree-model.test.ts. Not imported:
 * patch-tree.ts imports the present item id from the advent data module, whose
 * server-only schemas would then ride into the client build (rule 6,
 * scripts/check-client-bundle.mjs). The server still decides when it's lit.
 */
export const STAR_AT = 12; // TUNE: mirrors PATCH_TREE.starAt (owner answer 5)

/** The most hearts one patch-mate's card shows (more warmth still shows this many). */
export const HEARTS_MAX = 5; // TUNE:

export function treeOf(view: Pick<MapView, 'christmas'> | null | undefined): PatchTree | null {
  return view?.christmas?.tree ?? null;
}

/** What `tree.decorated` says the tree is now (its public view). */
export interface Decorated {
  readonly postIndex: number;
  readonly ornaments: number;
  readonly starLit: boolean;
}

/**
 * The tree after a `tree.decorated`: the server's new total and star, never
 * counted down or put out by an event that arrives late (a total the copy
 * already passed, from a view fetched after it). A tree not planted in the
 * copy yet (the first December gift plants it) comes from the event.
 */
export function decorate(tree: PatchTree | null, event: Decorated): PatchTree {
  if (!tree || tree.postIndex !== event.postIndex) {
    return { postIndex: event.postIndex, ornaments: event.ornaments, starLit: event.starLit };
  }
  return {
    postIndex: tree.postIndex,
    ornaments: Math.max(tree.ornaments, event.ornaments),
    starLit: tree.starLit || event.starLit,
  };
}

/**
 * The little line the map shows when the tree moved on between two views of
 * the same patch: the star lighting, else ornaments going up (with how many
 * are left to light the star, from `STAR_AT`). Null when nothing
 * went up (the same tree, a fresh copy, or the first view of a patch).
 */
export function treeNotice(before: PatchTree | null, after: PatchTree | null): string | null {
  if (!after) return null;
  if (after.starLit && before?.starLit !== true) return TREE_TEXT.starLit;
  const added = after.ornaments - (before?.ornaments ?? 0);
  if (added <= 0) return null;
  const went = added === 1 ? TREE_TEXT.ornament : TREE_TEXT.ornaments(added);
  const left = STAR_AT - after.ornaments;
  return !after.starLit && left > 0 ? `${went} ${TREE_TEXT.toGo(left)}` : went;
}

/**
 * Hearts on a patch-mate's card: my warmth with them (`MapView.christmas.warmth`),
 * at most `HEARTS_MAX`; 0 (no row) with none, on my own card, or out of season.
 * Hearts only: never a number to rank by.
 */
export function heartsFor(
  warmth: MapViewChristmas['warmth'] | undefined,
  userId: string,
  me: string | null,
): number {
  if (!warmth || userId === me) return 0;
  const w = warmth.find((x) => x.userId === userId)?.warmth ?? 0;
  return Math.max(0, Math.min(HEARTS_MAX, Math.floor(w)));
}
