import { el } from '../ui/dom.js';
import type { TileActions } from './map-screen.js';

/**
 * Several features' entries in one tile panel (gathering #17, home base #18):
 * each draws into its own slot, in order, and never clears another's.
 */
export function combineTileActions(...features: readonly TileActions[]): TileActions {
  const slots = new WeakMap<HTMLElement, HTMLElement[]>();
  return {
    show: (container, tile, view) => {
      let boxes = slots.get(container);
      if (!boxes) {
        boxes = features.map(() => el('div', { class: 'tile-actions-slot' }));
        container.replaceChildren(...boxes);
        slots.set(container, boxes);
      }
      features.forEach((feature, i) => {
        const box = boxes[i];
        if (box) feature.show(box, tile, view);
      });
    },
    hide: () => {
      for (const feature of features) feature.hide();
    },
  };
}

/**
 * Empties every feature's slot in a tile panel's actions, keeping the slots
 * themselves (`combineTileActions` draws into the same ones next time). For a
 * tile that offers nothing (water, #621): features' `hide` only forgets their
 * state, so the last tile's buttons would stay, acting on that tile.
 */
export function emptyTileActions(container: {
  readonly children: ArrayLike<{ replaceChildren: () => void }>;
}): void {
  for (const slot of Array.from(container.children)) slot.replaceChildren();
}
