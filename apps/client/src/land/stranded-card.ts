import type { Hex, StrandedTile } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { nearestGap, strandedLine, STRANDED_TEXT } from './stranded-text.js';

// The "Some land is cut off! 🧭" card (Wild Isle, #621), beside the "Some
// land misses you!" chip. Show me pans the camera to the gap.

export interface StrandedCard {
  /** My cut-off land now (empty or unset: the card is hidden). */
  set: (stranded: readonly StrandedTile[] | undefined) => void;
  readonly element: HTMLElement;
  readonly shown: boolean;
}

export function createStrandedCard(options: {
  root: HTMLElement;
  /** Pans the camera to a tile. */
  pan: (tile: Hex) => void;
  now?: () => number;
}): StrandedCard {
  const now = options.now ?? (() => Date.now());
  let list: readonly StrandedTile[] = [];
  const line = el('span', { class: 'land-chip-text' });
  const button = el(
    'button',
    { type: 'button', class: 'land-chip-visit', 'data-testid': 'stranded-show' },
    STRANDED_TEXT.show,
  );
  const card = el(
    'div',
    { class: 'land-chip land-stranded', role: 'status', 'data-testid': 'stranded-card' },
    el('span', { class: 'land-chip-text' }, el('strong', {}, STRANDED_TEXT.title), el('br'), line),
    button,
  );
  card.hidden = true;
  button.addEventListener('click', () => {
    const gap = nearestGap(list);
    if (gap) options.pan(gap);
  });
  options.root.append(card);
  return {
    set: (next) => {
      list = next ?? [];
      card.hidden = list.length === 0;
      if (list.length > 0) line.textContent = strandedLine(list, now());
    },
    element: card,
    get shown() {
      return !card.hidden;
    },
  };
}
