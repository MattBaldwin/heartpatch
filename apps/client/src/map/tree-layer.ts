import type { MapView } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import type { MapLayer } from './map-screen.js';
import { treeNotice, treeOf, type PatchTree } from './tree-model.js';
import './tree.css';

/*
 * The Patch Tree's little line on the map (#37 2d): when a newer view of the
 * same patch has more ornaments on the tree, or its star lit, a soft banner
 * says so for a moment ("An ornament went up on the Patch Tree! 🎄"). It
 * names the fun, never who gave whom (kid safety). Keyed off what the views
 * say, not off events, so a `tree.decorated` and the gift's later
 * `gift.collected` (or a resync) can't say it twice. The tree itself is drawn
 * by the map scene (`TreeField`).
 */

/** How long the line stays up. */
export const TREE_BEAT_MS = 3_200; // TUNE:

export interface TreeLayer extends MapLayer {
  readonly debug: { readonly line: string | null; readonly tree: PatchTree | null };
}

export function createTreeLayer(options: {
  readonly root: HTMLElement;
  /** Reduce Motion is on. */
  readonly reducedMotion?: () => boolean;
}): TreeLayer {
  const reduced = () =>
    options.reducedMotion?.() ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const beat = el('div', { class: 'tree-beat', role: 'status', 'data-testid': 'tree-beat' });
  beat.hidden = true;
  options.root.append(beat);
  let map: string | null = null;
  let tree: PatchTree | null = null;
  let line: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = (next: string): void => {
    line = next;
    beat.textContent = next;
    beat.classList.toggle('tree-beat-still', reduced());
    // Restart the drift-in for a second line while the first is still up.
    beat.hidden = true;
    void beat.offsetWidth;
    beat.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      line = null;
      beat.hidden = true;
    }, TREE_BEAT_MS);
  };

  const take = (view: MapView): void => {
    const next = treeOf(view);
    // A new patch (or the first look at one): what's already on its tree isn't news.
    const said = map === view.map.id ? treeNotice(tree, next) : null;
    map = view.map.id;
    tree = next;
    if (said) show(said);
  };

  return {
    attach: (_scene, view) => {
      if (map !== view.map.id) {
        clearTimeout(timer);
        line = null;
        beat.hidden = true;
      }
      take(view);
    },
    update: take,
    get debug() {
      return { line, tree };
    },
  };
}
