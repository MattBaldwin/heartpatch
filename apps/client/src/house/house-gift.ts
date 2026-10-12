import type { HouseGift } from '@heartpatch/shared';
import { itemIconNode } from '../inventory/item-icons.js';
import { el } from '../ui/dom.js';
import { houseButton } from './house-grow.js';
import { giftCard } from './house-gift-view.js';
import { GIFT_TEXT } from './house-view.js';

/*
 * The gift card's DOM (#381 H2): the eyebrow and ✕, the server's note as
 * given, what's inside with its icon, and Open it!. Everything it says comes
 * from `house-gift-view.ts`; the house screen owns the sheet and the claim.
 */

export interface GiftHandlers {
  onOpen: () => void;
  onClose: () => void;
}

/** The card for a wrapped gift: [its header, ...the rest]. */
export function giftPanel(gift: HouseGift, busy: boolean, on: GiftHandlers): HTMLElement[] {
  const card = giftCard(gift);
  // While it opens, Open it! stays focusable (focus doesn't fall to the page
  // and "Opening…" is read out where the player is) but ignores taps.
  const yes = houseButton(
    busy ? GIFT_TEXT.opening : card.open,
    () => {
      if (!busy) on.onOpen();
    },
    { class: 'house-gift-yes', 'data-testid': 'house-gift-yes' },
  );
  if (busy) yes.setAttribute('aria-disabled', 'true');
  const close = houseButton(
    GIFT_TEXT.closeIcon,
    () => {
      if (!busy) on.onClose();
    },
    {
      class: 'house-grow-close',
      'data-testid': 'house-gift-close',
      'aria-label': GIFT_TEXT.close,
    },
    true,
  );
  const header = el(
    'header',
    { class: 'house-grow-head house-gift-head' },
    el(
      'div',
      { class: 'house-grow-heading' },
      el('p', { class: 'house-grow-eyebrow' }, card.title),
      el('h3', { class: 'house-gift-note', 'data-testid': 'house-gift-note' }, card.note),
    ),
    close,
  );
  return [
    header,
    el(
      'p',
      { class: 'house-gift-item', 'data-testid': 'house-gift-item' },
      el(
        'span',
        { class: 'house-gift-icon', 'aria-hidden': 'true' },
        itemIconNode(card.itemId, 'house-gift-tool'),
      ),
      el('span', { class: 'house-gift-what' }, card.item),
    ),
    yes,
  ];
}

/**
 * The unwrap moment at `at` (CSS px: the box on screen): the box pops up
 * and away in a puff of sparkles, drawn on `layer` over the scene; just the
 * toast under reduced motion.
 */
export function giftPop(
  layer: HTMLElement,
  at: { x: number; y: number },
  reducedMotion: boolean,
): void {
  if (reducedMotion) return;
  const pop = el(
    'span',
    { class: 'house-gift-pop', 'aria-hidden': 'true' },
    el('span', { class: 'house-gift-pop-box' }, GIFT_TEXT.icon),
    ...Array.from({ length: 6 }, (_, i) => {
      const s = el('span', { class: 'house-gift-pop-bit' }, i % 2 ? '✨' : '⭐');
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      s.style.setProperty('--dx', Math.cos(angle).toFixed(3));
      s.style.setProperty('--dy', Math.sin(angle).toFixed(3));
      return s;
    }),
  );
  pop.style.left = `${String(at.x)}px`;
  pop.style.top = `${String(at.y)}px`;
  layer.append(pop);
  // Gone once it's played (and a backstop for a hidden tab, where no animation runs).
  setTimeout(() => {
    pop.remove();
  }, 1400);
}
