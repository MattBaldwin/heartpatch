import { el } from '../ui/dom.js';
import './weather.css';

// The Fix it card in the tile panel (#621 W1-9): small DOM helpers for
// home-screen.ts, so a knocked building's note, its cost and Fix it all show
// the moment its tile's panel opens, even on a 238pt-tall iPhone SE panel.

/** The cost chips and Fix it side by side: one short row, not two. */
export function fixRow(chips: HTMLElement, button: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: 'home-row home-row-wrap home-row-tight weather-fix-row' },
    chips,
    button,
  );
}

/** Room kept round the card when it is scrolled into the panel (px). // TUNE: */
const ROUND_CARD = 8;

/**
 * How far to scroll a panel (negative is up) so a card shows whole: just far
 * enough for its bottom (Fix it) to clear the panel's bottom, never so far
 * that its top goes under the panel's top; a card above the view is scrolled
 * back down to. `cardTop` and `cardBottom` are measured from the panel's top
 * edge; `height` is the panel's visible height.
 */
export function scrollToShow(cardTop: number, cardBottom: number, height: number): number {
  const toTop = cardTop - ROUND_CARD;
  if (toTop < 0) return toTop;
  return Math.max(0, Math.min(toTop, cardBottom + ROUND_CARD - height));
}

/**
 * Scrolls the tile panel holding `container` so the first knocked building's
 * card shows whole, scrolling no further than that (the panel's own header
 * stays in sight when there is room). Returns whether there was one. Instant,
 * so the panel opens already there.
 */
export function bringKnockedIntoView(container: HTMLElement): boolean {
  const card = container.querySelector('[data-testid$="-knocked"]')?.closest('.home-card');
  const panel = container.closest('.tile-panel');
  if (!card || !panel) return false;
  const box = panel.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  panel.scrollTop += scrollToShow(c.top - box.top, c.bottom - box.top, panel.clientHeight);
  return true;
}
