import { el } from '../ui/dom.js';
import { LORE_TEXT } from './lore-view.js';

// The Lorebook's way in from the Bag (#307): a tile at the top of the Bag
// sheet ("4 of 12 pages found", a "1 new" sparkle), and a sparkle on the Bag
// button itself while a page is unread. The sparkle is a tray alert, so the
// My Home handle glows too (ui/trays).

export interface LoreBagEntry {
  /** The tile at the top of the Bag sheet. */
  readonly tile: HTMLButtonElement;
  /** The sparkle for the Bag button. */
  readonly badge: HTMLElement;
  /** Shows the book's counts (hidden until the book is known). */
  update: (counts: { found: number; total: number; unread: number } | null) => void;
}

export function createLoreBagEntry(onOpen: () => void): LoreBagEntry {
  const count = el('span', { class: 'lore-bag-count', 'data-testid': 'bag-lorebook-count' });
  const fresh = el('span', { class: 'lore-bag-new', 'data-testid': 'bag-lorebook-new' });
  fresh.hidden = true;
  const tile = el(
    'button',
    { type: 'button', class: 'lore-bag-tile', 'data-testid': 'bag-lorebook' },
    fresh,
    el('span', { class: 'lore-bag-cover', 'aria-hidden': 'true' }, '📖'),
    el(
      'span',
      { class: 'lore-bag-words' },
      el('span', { class: 'lore-bag-title' }, LORE_TEXT.bagTile),
      count,
    ),
    el('span', { class: 'lore-bag-chevron', 'aria-hidden': 'true' }, '›'),
  );
  tile.hidden = true;
  tile.addEventListener('click', onOpen);
  const badge = el('span', {
    class: 'lore-bag-badge',
    'aria-hidden': 'true',
    'data-testid': 'bag-open-lore',
    'data-tray-alert': LORE_TEXT.news,
  });

  return {
    tile,
    badge,
    update: (counts) => {
      tile.hidden = counts === null || counts.total === 0;
      const unread = counts?.unread ?? 0;
      count.textContent = counts ? LORE_TEXT.bagCount(counts.found, counts.total) : '';
      fresh.hidden = unread === 0;
      fresh.textContent = unread > 0 ? LORE_TEXT.bagNew(unread) : '';
      badge.textContent = unread > 0 ? String(unread) : '';
    },
  };
}
