import type { CommunityView, MapView, PublicTile } from '@heartpatch/shared';
import type { TileActions } from '../map/map-screen.js';
import { el } from '../ui/dom.js';
import {
  COMMUNITY_TEXT,
  communityOf,
  communityPanel,
  perkLine,
  restoredTileLines,
} from './community-model.js';
import './hollowed.css';

// A Hollowed village tile's block in the tile panel (#306): what the village
// is, how my land reaches it, and Explore and Restore. PR 1 drew both
// buttons waiting; later PRs hook them up through `wire` (2a: exploring,
// 3: restoring), and the panel's rule for when they open stays the one here.
// A won village's square offers its winner "Name it" until they have (PR 3),
// says what its perk does, and hands over a gift kind's morning gift (PR 3b).

/** What a later PR does when its button is tapped on a village tile. */
export type CommunityAction = (community: CommunityView, tile: PublicTile, view: MapView) => void;

/**
 * Collects a won village's morning gift (PR 3b): `ok` with what went into
 * the bag ("Thank you! +3 🍪 Treats 🎁"), or why not.
 */
export type GiftAction = (community: CommunityView) => Promise<{ ok: boolean; text: string }>;

export interface CommunityActions extends TileActions {
  /** It's night on the map (the Hollow's night): villages close, and the open panel says so. */
  setNight: (night: boolean) => void;
  /** Hooks a button up (later PRs); null unhooks it. */
  wire: (button: Wired, action: CommunityAction | null) => void;
  /** Hooks the morning gift's button up (PR 3b); null unhooks it. */
  wireGift: (action: GiftAction | null) => void;
  /** The block on screen (the dev hook): its village and whether its buttons are open. */
  readonly debug: { community: string; explore: boolean; restore: boolean } | null;
}

type Wired = 'explore' | 'restore' | 'name';

export function createCommunityActions(me: () => string | null = () => null): CommunityActions {
  let night = false;
  const wired: Record<Wired, CommunityAction | null> = {
    explore: null,
    restore: null,
    name: null,
  };
  let giftAction: GiftAction | null = null;
  let shown: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  /**
   * What the last gift tap said, on its village's square until the panel
   * closes or shows another tile. `ok`: it's in the bag, whatever the view
   * says until its resync lands.
   */
  let said: { community: string; ok: boolean; text: string } | null = null;
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
      // Won: the square says what its perk does (PR 3b); its winner collects
      // a gift kind's morning gift there, and names it, until they have.
      const square = tile.q === c.square.q && tile.r === c.square.r;
      if (!square) {
        container.replaceChildren();
        return;
      }
      const perk = el(
        'div',
        { class: 'community-block', 'data-testid': 'community-perk' },
        el('p', { class: 'tile-action-note community-line' }, perkLine(c.kind)),
      );
      const mine = c.ownerUserId === me();
      const button = (which: 'gift' | 'name', label: string, onTap: () => void) => {
        const b = el(
          'button',
          { type: 'button', class: 'auth-button bag-action', 'data-testid': `community-${which}` },
          label,
        );
        b.addEventListener('click', onTap);
        return b;
      };
      const collect = (b: HTMLButtonElement, action: GiftAction) => {
        b.disabled = true;
        void action(c).then((result) => {
          said = { community: c.id, ...result };
          render();
        });
      };
      const lastSaid = said?.community === c.id ? said : null;
      const thanks = lastSaid
        ? [
            el(
              'p',
              {
                class: `tile-action-note ${lastSaid.ok ? 'community-said' : 'community-oops'}`,
                'data-testid': 'community-said',
              },
              lastSaid.text,
            ),
          ]
        : [];
      const giftButton = (action: GiftAction) => {
        const b = button('gift', COMMUNITY_TEXT.giftReady, () => {
          collect(b, action);
        });
        return b;
      };
      const gift =
        !mine || !c.gift || !giftAction
          ? []
          : c.gift.ready && lastSaid?.ok !== true
            ? [...thanks, giftButton(giftAction)]
            : [
                ...thanks,
                el(
                  'p',
                  {
                    class: 'tile-action-note community-line',
                    'data-testid': 'community-gift-taken',
                  },
                  COMMUNITY_TEXT.giftTaken,
                ),
              ];
      const nameIt = wired.name;
      const name =
        mine && nameIt && c.named === false
          ? [
              button('name', COMMUNITY_TEXT.nameIt, () => {
                nameIt(c, tile, view);
              }),
            ]
          : [];
      container.replaceChildren(perk, ...gift, ...name);
      return;
    }
    // A tile restored on its own: in colour again, and ordinary land (PR 4):
    // the territory action's Claim or Challenge sits under this block.
    if ((c.restoredTiles ?? []).some((t) => t.q === tile.q && t.r === tile.r)) {
      const words = communityPanel(c, tile.terrain, night);
      container.replaceChildren(
        el(
          'div',
          { class: 'community-block', 'data-testid': 'community-block' },
          el('p', { class: 'tile-action-note community-line community-reach' }, words.restored),
          ...restoredTileLines(c, tile, me()).map((line) =>
            el('p', { class: 'tile-action-note community-line' }, line),
          ),
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
      if (shown && (shown.tile.q !== tile.q || shown.tile.r !== tile.r)) said = null;
      shown = { container, tile, view };
      render();
    },
    hide: () => {
      shown?.container.replaceChildren();
      shown = null;
      said = null;
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
    wireGift: (action) => {
      giftAction = action;
      render();
    },
    get debug() {
      return debug;
    },
  };
}
