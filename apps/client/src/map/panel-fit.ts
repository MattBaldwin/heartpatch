// The tile panel ends between rows, never through one (#721 follow-up): a
// busy tile's panel taller than its cap (map.css) stops just above the first
// row that doesn't fit whole, and a soft fade at its foot says there's more to
// scroll to. Measured from the panel, so it follows a resize or a new row.
// The Build sheet is the exception: its Build! row is pinned to the panel's
// foot (building/build.css), so it keeps its cap and never fades.

import { moreAttr, scrollMore } from '../ui/keeper/scroll-hint.js';

/** A row's top and bottom (px) in the panel's content, from its top edge. */
export interface RowBox {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Below this share of its cap the panel would get too short (one tall card),
 * so it keeps the cap and scrolls as before. // TUNE:
 */
const MIN_SHARE = 0.6;

/** Less than this into a row (px) counts as clear of it: subpixel layout rounds. */
const SLACK = 1;

/**
 * The panel's height (px) for a cap and its rows: the cap itself when it ends
 * between rows, else the top of the first row it would cut, so every row in
 * sight is whole. Rows side by side (a pair of buttons) count as one line.
 */
export function wholeRowHeight(cap: number, rows: readonly RowBox[]): number {
  let cut = cap;
  for (;;) {
    const sliced = rows.find((r) => r.top < cut - SLACK && r.bottom > cut + SLACK);
    if (sliced === undefined) break;
    cut = sliced.top;
  }
  return cut < cap * MIN_SHARE ? cap : cut;
}

/** Containers whose children are the rows; anything else is a row itself. */
const ROW_GROUP = new Set(['DIV', 'SECTION', 'UL', 'OL']);

function collectRows(node: Element, origin: number, out: RowBox[]): void {
  for (const child of node.children) {
    if (
      ROW_GROUP.has(child.tagName) &&
      child.childElementCount > 0 &&
      !child.classList.contains('tile-panel-head')
    ) {
      collectRows(child, origin, out);
      continue;
    }
    const box = child.getBoundingClientRect();
    if (box.height > 0) out.push({ top: box.top - origin, bottom: box.bottom - origin });
  }
}

/** Sizes the panel to whole rows under its CSS cap and marks where it has more. */
function fit(panel: HTMLElement): void {
  if (panel.hidden || building(panel)) {
    panel.style.maxHeight = '';
    if (!panel.hidden) hint(panel);
    return;
  }
  // Measuring at the full cap shortens how far the panel can scroll, so the
  // browser pulls its scroll back; put it back after, or a refit while
  // scrolled down (a pick in the guard picker) moves the rows under a finger.
  const scrolled = panel.scrollTop;
  panel.style.maxHeight = '';
  const cap = parseFloat(getComputedStyle(panel).maxHeight);
  let next = '';
  if (Number.isFinite(cap) && panel.scrollHeight > cap) {
    const rows: RowBox[] = [];
    collectRows(panel, panel.getBoundingClientRect().top - panel.scrollTop, rows);
    const height = wholeRowHeight(cap, rows);
    if (height < cap) next = `${String(height)}px`;
  }
  panel.style.maxHeight = next;
  panel.scrollTop = scrolled;
  hint(panel);
}

/** The Build sheet is up in the panel (fence care's steps keep whole rows). */
function building(panel: HTMLElement): boolean {
  return panel.querySelector('.build-sheet:not([hidden])') !== null;
}

function hint(panel: HTMLElement): void {
  if (building(panel)) {
    panel.dataset['more'] = 'none';
    return;
  }
  panel.dataset['more'] = moreAttr(
    scrollMore(panel.scrollTop, panel.clientHeight, panel.scrollHeight),
  );
}

/** Keeps the panel at whole rows, with its fade, while it's in the page. */
export function watchPanelFit(panel: HTMLElement): () => void {
  let frame = 0;
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      fit(panel);
    });
  };
  panel.addEventListener(
    'scroll',
    () => {
      hint(panel);
    },
    { passive: true },
  );
  window.addEventListener('resize', schedule);
  // A row shown or hidden, a new action, the Build sheet's class: refit.
  new MutationObserver(schedule).observe(panel, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden', 'class'],
  });
  // Late fonts or a new line in a row change its height without a mutation.
  if (typeof ResizeObserver !== 'undefined') {
    const sizes = new ResizeObserver(schedule);
    for (const child of panel.children) sizes.observe(child);
  }
  return schedule;
}
