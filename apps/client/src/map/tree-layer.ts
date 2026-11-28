import type { MapView } from '@heartpatch/shared';
import type { MapLayer } from './map-screen.js';
import { treeNotice, treeOf, type PatchTree } from './tree-model.js';

/*
 * The Patch Tree's little line on the map (#37 2d): when a newer view of the
 * same patch has more ornaments on the tree, or its star lit, the patch line
 * says so ("An ornament went up on the Patch Tree! 🎄"), in its turn, so it
 * waits behind the other notes at the top and the land chip steps aside. It
 * names the fun, never who gave whom (kid safety). Keyed off what the views
 * say, not off events, so a `tree.decorated` and the gift's later
 * `gift.collected` (or a resync) can't say it twice. The tree itself is drawn
 * by the map scene (`TreeField`).
 */

export function createTreeLayer(options: {
  /** Says one line on the patch line (`PatchLine.say`). */
  readonly say: (text: string) => void;
}): MapLayer {
  let map: string | null = null;
  let tree: PatchTree | null = null;

  const take = (view: MapView): void => {
    const next = treeOf(view);
    // A new patch (or the first look at one): what's already on its tree isn't news.
    const said = map === view.map.id ? treeNotice(tree, next) : null;
    map = view.map.id;
    tree = next;
    if (said) options.say(said);
  };

  return {
    attach: (_scene, view) => {
      take(view);
    },
    update: take,
  };
}
