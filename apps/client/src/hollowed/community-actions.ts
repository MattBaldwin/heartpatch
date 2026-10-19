import type { CommunityView, MapView, PublicTile } from '@heartpatch/shared';
import type { TileActions } from '../map/map-screen.js';
import { el } from '../ui/dom.js';
import { COMMUNITY_TEXT, communityOf, communityPanel } from './community-model.js';
import './hollowed.css';

// A Hollowed village tile's block in the tile panel (#306): what the village
// is, how my land reaches it, and Explore and Restore. PR 1 drew both
// buttons waiting; later PRs hook them up through `wire` (2a: exploring,
// 3: restoring), and the panel's rule for when they open stays the one here.
// A won village's square offers its winner "Name it" until they have (PR 3).

/** What a later PR does when its button is tapped on a village tile. */
export type CommunityAction = (community: CommunityView, tile: PublicTile, view: MapView) => void;

export interface CommunityActions extends TileActions {
  /** It's night on the map (the Hollow's night): villages close, and the open panel says so. */
  setNight: (night: boolean) => void;
  /** Hooks a button up (later PRs); null unhooks it. */
  wire: (button: 'explore' | 'restore' | 'name', action: CommunityAction | null) => void;
  /** The block on screen (the dev hook): its village and whether its buttons are open. */
  readonly debug: { community: string; explore: boolean; restore: boolean } | null;
}

export function createCommunityActions(me: () => string | null = () => null): CommunityActions {
  let night = false;
  const wired: Record<'explore' | 'restore' | 'name', CommunityAction | null> = {
    explore: null,
    restore: null,
    name: null,
  };
  let shown: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let debug: CommunityActions['debug'] = null;

  const render = (): void => {
    debug = null;
    if (!shown) return;
    const { container, tile, view } = shown;
    const c = communityOf(view, tile);
    if (!c) {
      container.replaceChildren();
      return;
    }
    if (c.ownerUserId !== null) {
      // Won: its winner may name it on the square, until they have.
      const name = wired.name;
      const square = tile.q === c.square.q && tile.r === c.square.r;
      if (!name || c.ownerUserId !== me() || c.named !== false || !square) {
        container.replaceChildren();
        return;
      }
      const b = el(
        'button',
        { type: 'button', class: 'auth-button bag-action', 'data-testid': 'community-name' },
        COMMUNITY_TEXT.nameIt,
      );
      b.addEventListener('click', () => {
        name(c, tile, view);
      });
      container.replaceChildren(b);
      return;
    }
    // A tile restored on its own: in colour again, and someone's land.
    if ((c.restoredTiles ?? []).some((t) => t.q === tile.q && t.r === tile.r)) {
      const words = communityPanel(c, tile.terrain, night);
      container.replaceChildren(
        el(
          'div',
          { class: 'community-block', 'data-testid': 'community-block' },
          el('p', { class: 'tile-action-note community-line community-reach' }, words.restored),
          el('p', { class: 'tile-action-note community-line' }, COMMUNITY_TEXT.tileRestored),
        ),
      );
      return;
    }
    const words = communityPanel(
      c,
      tile.terrain,
      night,
      wired.explore !== null,
      undefined,
      wired.restore !== null,
    );
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
              class: `tile-action-note community-line${i === 0 ? ' community-reach' : ''}`,
            },
            text,
          ),
        ),
      ),
      explore,
      restore,
      ...(words.note ? [el('p', { class: 'tile-action-note community-soon' }, words.note)] : []),
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
