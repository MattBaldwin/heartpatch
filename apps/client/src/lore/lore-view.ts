import type { LorePage } from '@heartpatch/shared';

// What the Lorebook shows (design doc §16). Pure, so it's tested without a DOM.

export const LORE_TEXT = {
  found: 'You found a lore page!',
  title: 'Lorebook',
  empty: 'No pages yet. Keep exploring, and listen for tiny paws…',
  open: 'Lorebook',
  close: 'Close',
  next: 'Next page',
} as const;

/** Found pages this device hasn't shown yet, oldest first. */
export function newPages(pages: readonly LorePage[], shown: ReadonlySet<string>): LorePage[] {
  return pages.filter((p) => !shown.has(p.id));
}
