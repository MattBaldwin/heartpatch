import { isBigChest, type SearchSpotResponse, type SpotInteraction } from '@heartpatch/shared';
import { isChest } from './cellar-look.js';

// The hidden cellar's words and chest buttons (#306, owner decision of
// 2026-10-22), pure so they're unit-tested. Style guide: cozy, short,
// kid-readable; "Hollow", never "village" or "community".

export const CELLAR_TEXT = {
  /** The action button by a chest, away from one, and once every chest is open. */
  open: 'Open',
  findChest: 'Find a chest',
  allOpen: 'All open!',
  /** The chest's gesture: hold until it pops (the `lift` reducer). */
  hint: 'Hold to open it!',
  easy: 'tap to open',
  note: 'Hold anywhere until the lid pops.',
  /** The big chest's card. */
  bigTitle: 'The big chest! 👑',
  keepsake: 'A one-of-a-kind keepsake! Only this kind of Hollow hides it.',
  keepsakeOwned: 'You already have this Hollow kind’s keepsake, so it’s all treasure this time!',
  /** A small chest's card (a rare find in it). */
  smallTitle: 'Treasure! 🎁',
} as const;

/** "2 of 6 chests open 🗝️", or "Every chest is open! ✨". */
export function chestsLine(progress: { searched: number; total: number }): string {
  if (progress.total > 0 && progress.searched >= progress.total) return 'Every chest is open! ✨';
  return `${String(progress.searched)} of ${String(progress.total)} chests open 🗝️`;
}

/** The action button by a chest: a key, "Open", held like a lift. */
export function chestAction(spot: { readonly kind: string }): {
  readonly icon: string;
  readonly label: string;
  readonly interaction: SpotInteraction;
} {
  return { icon: isBigChest(spot) ? '👑' : '🗝️', label: CELLAR_TEXT.open, interaction: 'lift' };
}

/** The chest gesture's overlay text (the lift's, in a chest's words). */
export function chestPlayText(spot: { readonly kind: string }): {
  icon: string;
  hint: string;
  easy: string;
  note: string;
} {
  return {
    icon: isBigChest(spot) ? '👑' : '🗝️',
    hint: CELLAR_TEXT.hint,
    easy: CELLAR_TEXT.easy,
    note: CELLAR_TEXT.note,
  };
}

/** The card's title for what a chest held. */
export function chestCardTitle(spot: { readonly kind: string }): string {
  return isBigChest(spot) ? CELLAR_TEXT.bigTitle : CELLAR_TEXT.smallTitle;
}

/** The big chest's extra line: its keepsake, or why there's none this time. */
export function keepsakeLine(found: Pick<SearchSpotResponse, 'clothing'>): string {
  return found.clothing ? CELLAR_TEXT.keepsake : CELLAR_TEXT.keepsakeOwned;
}

/**
 * How long a chest's card waits so its moment shows first, ms: the big
 * chest's wobble and swing, or a small lid's pop.
 */
export function cardDelayMs(spot: { readonly kind: string }): number {
  if (!isChest(spot)) return 0;
  return isBigChest(spot) ? 2400 : 450; // TUNE: the big moment's wobble, swing and fountain; a lid's pop
}
