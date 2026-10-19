import type { CommunityView, MapView, PublicTile } from '@heartpatch/shared';
import type { TileActions } from '../map/map-screen.js';
import { el } from '../ui/dom.js';
import { COMMUNITY_TEXT, communityOf, communityPanel } from './community-model.js';
import './hollowed.css';

// A Hollowed village tile's block in the tile panel (#306): what the village
// is, how my land reaches it, and Explore and Restore. PR 1 draws both
// buttons waiting; later PRs hook them up through `wire` (2a: exploring,
// 3: restoring), and the panel's rule for when they open stays the one here.

/** What a later PR does when its button is tapped on a village tile. */
export type CommunityAction = (community: CommunityView, tile: PublicTile, view: MapView) => void;

export interface CommunityActions extends TileActions {
  /** It's night on the map (the Hollow's night): villages close, and the open panel says so. */
  setNight: (night: boolean) => void;
  /** Hooks a button up (later PRs); null unhooks it. */
  wire: (button: 'explore' | 'restore', action: CommunityAction | null) => void;
  /** The block on screen (the dev hook): its village and whether its buttons are open. */
  readonly debug: { community: string; explore: boolean; restore: boolean } | null;
}

export function createCommunityActions(): CommunityActions {
  let night = false;
  const wired: Record<'explore' | 'restore', CommunityAction | null> = {
    explore: null,
    restore: null,
  };
  let shown: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let debug: CommunityActions['debug'] = null;

  const render = (): void => {
    debug = null;
    if (!shown) return;
    const { container, tile, view } = shown;
    const c = communityOf(view, tile);
    if (!c || c.ownerUserId !== null) {
      container.replaceChildren();
      return;
    }
    const words = communityPanel(c, tile.terrain, night, wired.explore !== null);
    const lines = [
      // Someone's land: the panel's head says whose, so the progress goes here.
      ...(tile.ownerUserId !== null ? [words.restored] : []),
      ...words.lines,
    ];
    const button = (which: 'explore' | 'restore', label: string) => {
      const action = wired[which];
      const b = el(
        'button',
        {
          type: 'button',
          class: 'auth-button bag-action tile-action-pair community-action',
          'data-testid': `community-${which}`,
        },
        label,
      );
      b.disabled = !words.open || action === null;
      if (action) {
        b.addEventListener('click', () => {
          action(c, tile, view);
        });
      }
      return b;
    };
    const explore = button('explore', COMMUNITY_TEXT.explore);
    const restore = button('restore', COMMUNITY_TEXT.restore);
    container.replaceChildren(
      el(
        'div',
        { class: 'community-block', 'data-testid': 'community-block' },
        ...lines.map((text, i) =>
          el(
            'p',
            {
              class: `tile-action-note community-line${i === lines.length - 1 ? ' community-reach' : ''}`,
            },
            text,
          ),
        ),
      ),
      explore,
      restore,
      ...(words.note
        ? [el('p', { class: 'tile-action-note community-soon' }, words.note)]
        : []),
    );
    debug = { community: c.name, explore: !explore.disabled, restore: !restore.disabled };
  };

  return {
    show: (container, tile, view) => {
      shown = { container, tile, view };
      render();
    },
    hide: () => {
      shown?.container.replaceChildren();
      shown = null;
      debug = null;
    },
    setNight: (next) => {
      if (next === night) return;
      night = next;
      render();
    },
    wire: (which, action) => {
      wired[which] = action;
      render();
    },
    get debug() {
      return debug;
    },
  };
}
