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

/** Room kept above the card when it is scrolled to the panel's top (px). // TUNE: */
const ABOVE_CARD = 8;

/**
 * Scrolls the tile panel holding `container` so the first knocked building's
 * card starts at its top. Returns whether there was one. Instant, so the
 * panel opens already there.
 */
export function bringKnockedIntoView(container: HTMLElement): boolean {
  const card = container.querySelector('[data-testid$="-knocked"]')?.closest('.home-card');
  const panel = container.closest('.tile-panel');
  if (!card || !panel) return false;
  const offset = card.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  panel.scrollTop = Math.max(0, panel.scrollTop + offset - ABOVE_CARD);
  return true;
}
