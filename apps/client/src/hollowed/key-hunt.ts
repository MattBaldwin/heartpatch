import type { CommunityView, Hex, MapView, PublicTile } from '@heartpatch/shared';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { cellarApi, type CellarApi } from './cellar-api.js';
import { KEY_HUNT, TREASURE_MAP } from './hollowed-config.js';
import { createKeyGlow, type KeyGlow } from './key-glow.js';
import {
  bagMaps,
  glintLine,
  KEY_TEXT,
  keyHuntOn,
  keyMaps,
  newMaps,
  type KeyHuntBlock,
} from './key-hunt-view.js';
import { paintTreasureMap, planTreasureMap } from './treasure-map.js';
import './hollowed.css';

// The key hunt and the hidden cellar on the map (#306 PR 2c, owner decision
// 5; reworked by owner decision 2026-10-22): winning a Hollow pops its
// treasure map once (an old drawing of the patch with an ✕ on the key's
// tile, treasure-map.ts), kept in the bag and on the square's panel to open
// again; the key's tile glows gold on the world map (key-glow.ts); the key
// is found by exploring that tile once it's mine (a glinting spot, the
// explore view); and the square's panel opens the cellar door and takes me
// down into it. The server decides everything (rule 1); this only shows what
// the map view says.

export interface KeyHuntOptions {
  root: HTMLElement;
  me: () => string | null;
  mapId: () => string | null;
  api?: Pick<CellarApi, 'open'>;
  /** Glides the camera to the key's tile and taps it (the map's "Show me on the map"). */
  showKey: (at: Hex) => void;
  /** Down into the open cellar. */
  enterCellar: (communityId: string) => void;
  /** Another card is up (the joy or naming card, the care sheet): the map waits its turn. */
  busy: () => boolean;
  /** The device's pixel ratio, for a crisp map (tests pass 1). */
  dpr?: () => number;
  /** Where the bag shows the treasure maps (`bagEntry`); its own box otherwise. */
  bag?: HTMLElement;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface KeyHuntDebug {
  /** The treasure map's Hollow, or null when it's shut. */
  readonly card: string | null;
  /** The panel's block on the tile shown, or null. */
  readonly block: { kind: KeyHuntBlock['kind']; state: string } | null;
  readonly said: string | null;
  /** The key tiles glowing on the world map. */
  readonly glowing: readonly { q: number; r: number }[];
  /** The bag's treasure maps, by Hollow. */
  readonly bag: readonly string[];
}

export interface KeyHunt {
  readonly tileActions: TileActions;
  /** Watches the map view for a newly won Hollow's map. */
  readonly layer: MapLayer;
  /** The key tiles' gold glow on the world map. */
  readonly glow: KeyGlow;
  /** The bag's treasure maps (a tile each while a hunt is on). */
  readonly bagEntry: HTMLElement;
  /** Opens a Hollow's treasure map (the bag, the square's panel). */
  openMap: (communityId: string) => void;
  /** Another card closed: a map that waited shows after a beat, once nothing else is up. */
  showWaiting: () => void;
  close: () => void;
  readonly debug: KeyHuntDebug;
}

export function createKeyHunt(options: KeyHuntOptions): KeyHunt {
  const api = options.api ?? cellarApi;
  const dpr = options.dpr ?? (() => window.devicePixelRatio || 1);
  const card = el('section', {
    class: 'hollowed-sheet key-map-sheet',
    role: 'dialog',
    'aria-labelledby': 'key-map-title',
    'data-testid': 'key-map-card',
  });
  card.hidden = true;
  options.root.append(card);
  const bagEntry = options.bag ?? el('div');
  bagEntry.classList.add('key-map-bag');
  bagEntry.dataset['testid'] = 'bag-key-maps';
  bagEntry.hidden = true;
  const glow = createKeyGlow(options.me);

  /** Hollows whose map waits its turn (another card up, then a beat). */
  const waiting: CommunityView[] = [];
  let carded: CommunityView | null = null;
  let seen: { mapId: string; communities: readonly CommunityView[] } | null = null;
  /** The map view now: the treasure map is drawn from its tiles. */
  let current: MapView | null = null;
  let shown: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let working = false;
  /** Why the last open failed, on that tile until the panel shows another. */
  let said: { at: string; text: string } | null = null;
  let block: KeyHunt['debug']['block'] = null;
  /** The bag's tiles as last drawn (id and line each), and their Hollows (the dev hook). */
  let inBag = '';
  let bagIds: string[] = [];
  /** The next look for a turn to show a waiting map, while one is pending. */
  let turn: ReturnType<typeof setTimeout> | null = null;
  /** Arms the map's buttons `KEY_HUNT.tapGuardMs` after it shows. */
  let arming: ReturnType<typeof setTimeout> | null = null;
  /** Draws the open map again at the room it has now; null while it's shut. */
  let redraw: (() => void) | null = null;
  // One key hunt lives as long as the app (main.ts), so this listener does too.
  window.addEventListener('resize', () => {
    redraw?.();
  });

  const where = (t: Hex) => `${String(t.q)},${String(t.r)}`;

  const closeCard = (): void => {
    if (turn !== null) clearTimeout(turn);
    if (arming !== null) clearTimeout(arming);
    turn = null;
    arming = null;
    carded = null;
    redraw = null;
    card.hidden = true;
    card.replaceChildren();
  };

  /** The treasure map: the old drawing, the ✕, and the way there. `first`: it just came with the win. */
  const showCard = (waited: CommunityView, first: boolean): void => {
    const view = current;
    // As the map view has it now: a Hollow named since its win shows its new name.
    const c = view?.communities?.find((x) => x.id === waited.id) ?? waited;
    const key = c.cellar?.state === 'hunt' ? c.cellar.keyTile : undefined;
    if (!view || !key) return;
    carded = c;
    const button = (label: string, testId: string, soft: boolean, onTap: () => void) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: soft
            ? 'auth-button auth-button-soft hollowed-soft'
            : 'auth-button hollowed-primary',
          'data-testid': testId,
        },
        label,
      );
      b.addEventListener('click', () => {
        // A tap that was meant for the card before this one isn't for us.
        if (card.dataset['armed'] !== 'true') return;
        onTap();
      });
      return b;
    };
    const canvas = el('canvas', {
      class: 'key-map-drawing',
      role: 'img',
      'aria-label': KEY_TEXT.mapLabel(c.name),
      'data-testid': 'key-map-drawing',
    });
    const glint = el('span', { class: 'key-map-glint', 'aria-hidden': 'true' });
    // The paper is the drawing's own size, centred in the frame, so the glint sits on its ✕.
    const frame = el(
      'div',
      { class: 'key-map-frame' },
      el('div', { class: 'key-map-paper' }, canvas, glint),
    );
    card.replaceChildren(
      el('p', { class: 'hollowed-kicker' }, KEY_TEXT.mapKicker(c.name)),
      el('h3', { class: 'hollowed-title', id: 'key-map-title' }, KEY_TEXT.mapTitle),
      frame,
      el('p', { class: 'hollowed-line key-map-line' }, KEY_TEXT.mapLine),
      el('p', { class: 'hollowed-note key-map-how' }, KEY_TEXT.mapHow),
      el(
        'div',
        { class: 'hollowed-actions' },
        button(KEY_TEXT.showMe, 'key-map-show', false, () => {
          closeCard();
          options.showKey(key);
          showWaiting();
        }),
        button(first ? KEY_TEXT.later : KEY_TEXT.close, 'key-map-later', true, () => {
          closeCard();
          // A second Hollow's map, if one is waiting, takes its turn next.
          showWaiting();
        }),
      ),
    );
    card.dataset['armed'] = 'false';
    card.hidden = false;
    // Drawn once it's laid out, at the room the card has (never pixelated: at
    // the DPR), and again when that room changes (an iPad turned round).
    redraw = () => {
      const plan = planTreasureMap(
        view.tiles,
        { key, start: c.square },
        {
          maxWidth: Math.max(200, frame.clientWidth || 300),
          maxHeight: Math.max(160, Math.round(window.innerHeight * TREASURE_MAP.maxScreenShare)),
        },
      );
      paintTreasureMap(canvas, plan, dpr());
      if (plan.key) {
        glint.style.left = `${String(plan.key.x)}px`;
        glint.style.top = `${String(plan.key.y)}px`;
        glint.style.setProperty('--glint', `${String(Math.max(18, plan.radius * 2.6))}px`);
      }
      glint.hidden = plan.key === null;
    };
    redraw();
    arming = setTimeout(() => {
      arming = null;
      card.dataset['armed'] = 'true';
    }, KEY_HUNT.tapGuardMs);
  };

  /**
   * Waits its turn: a beat after the last look, and only once nothing else
   * is up (it looks again until then). One look pending at a time.
   */
  const showWaiting = (): void => {
    if (carded || turn !== null || waiting.length === 0) return;
    turn = setTimeout(() => {
      turn = null;
      if (carded || waiting.length === 0) return;
      if (options.busy()) {
        showWaiting();
        return;
      }
      const next = waiting.shift();
      if (next) showCard(next, true);
    }, KEY_HUNT.afterCardMs);
  };

  const openMap = (communityId: string): void => {
    const c = current?.communities?.find((x) => x.id === communityId);
    if (!c) return;
    closeCard();
    showCard(c, false);
  };

  /** The bag's treasure maps: one tile for each hunt on. */
  const renderBag = (view: MapView): void => {
    const maps = bagMaps(view, options.me());
    // By name too: naming the Hollow after its win changes the line.
    const drawn = maps.map((m) => `${m.id}:${m.line}`).join('\n');
    if (drawn === inBag) return;
    inBag = drawn;
    bagIds = maps.map((m) => m.id);
    bagEntry.hidden = maps.length === 0;
    bagEntry.replaceChildren(
      ...maps.map(({ id, line }) => {
        const tile = el(
          'button',
          { type: 'button', class: 'key-map-bag-tile', 'data-testid': 'bag-key-map' },
          el('span', { class: 'key-map-bag-cover', 'aria-hidden': 'true' }, '🗺️'),
          el(
            'span',
            { class: 'key-map-bag-words' },
            el('span', { class: 'key-map-bag-title' }, KEY_TEXT.bagTile),
            el('span', { class: 'key-map-bag-line' }, line),
          ),
          el('span', { class: 'key-map-bag-chevron', 'aria-hidden': 'true' }, '›'),
        );
        tile.addEventListener('click', () => {
          openMap(id);
        });
        return tile;
      }),
    );
  };

  const watch = (view: MapView): void => {
    const communities = view.communities ?? [];
    const before = seen?.mapId === view.map.id ? seen.communities : null;
    if (seen?.mapId !== view.map.id) {
      waiting.length = 0;
      closeCard();
    }
    seen = { mapId: view.map.id, communities };
    current = view;
    renderBag(view);
    // The key found (or the Hollow left): its map goes with the hunt.
    if (carded && !keyMaps(view, options.me()).some((m) => m.community.id === carded?.id)) {
      closeCard();
    }
    waiting.push(...newMaps(before, communities, options.me()));
    showWaiting();
  };

  /** Opens the cellar door; the view comes back with the map's next resync. */
  const openCellar = async (c: CommunityView, at: Hex): Promise<void> => {
    const mapId = options.mapId();
    if (!mapId || working) return;
    working = true;
    render();
    try {
      // A lost reply is retried with the same key, so an open that went in replays.
      const done = await sendCommand(
        {
          newKey: newIdempotencyKey,
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          retryAfterMs: COMMAND_RETRY_MS,
        },
        (key) => api.open(mapId, c.id, key),
        () => options.mapId() === mapId,
      );
      if (done === null) return;
      said = null;
      options.enterCellar(c.id);
    } catch (err) {
      said = { at: where(at), text: messageOf(err) };
    } finally {
      working = false;
      render();
    }
  };

  const render = (): void => {
    block = null;
    if (!shown) return;
    const { container, tile, view } = shown;
    const lastSaid = said?.at === where(tile) ? said : null;
    const note = lastSaid
      ? [
          el(
            'p',
            { class: 'tile-action-note community-oops', 'data-testid': 'key-said' },
            lastSaid.text,
          ),
        ]
      : [];
    const on = keyHuntOn(view, tile, options.me());
    if (!on) {
      container.replaceChildren(...note);
      return;
    }
    const line = (text: string) => el('p', { class: 'tile-action-note community-line' }, text);
    const button = (label: string, testId: string, onTap: () => void) => {
      const b = el(
        'button',
        { type: 'button', class: 'auth-button bag-action', 'data-testid': testId },
        label,
      );
      b.disabled = working;
      b.addEventListener('click', onTap);
      return b;
    };
    const c = on.community;
    if (on.kind === 'key') {
      // What to do next to find it; Explore (or Claim, or Challenge) is the tile's own button.
      block = { kind: 'key', state: on.land };
      container.replaceChildren(
        el(
          'div',
          { class: 'community-block', 'data-testid': 'key-block' },
          line(glintLine(on.land)),
        ),
        ...note,
      );
      return;
    }
    block = { kind: 'square', state: on.state };
    const words =
      on.state === 'hunt'
        ? KEY_TEXT.hunt
        : on.state === 'key'
          ? KEY_TEXT.hasKey
          : KEY_TEXT.cellarLine;
    const actions =
      on.state === 'hunt'
        ? [
            button(KEY_TEXT.openMap, 'key-open-map', () => {
              openMap(c.id);
            }),
          ]
        : on.state === 'key'
          ? [
              button(working ? KEY_TEXT.opening : KEY_TEXT.open, 'cellar-open', () => {
                void openCellar(c, tile);
              }),
            ]
          : [
              button(KEY_TEXT.goDown, 'cellar-enter', () => {
                options.enterCellar(c.id);
              }),
            ];
    container.replaceChildren(
      el('div', { class: 'community-block', 'data-testid': 'cellar-block' }, line(words)),
      ...actions,
      ...note,
    );
  };

  return {
    tileActions: {
      show: (container, tile, view) => {
        if (shown && where(shown.tile) !== where(tile)) said = null;
        shown = { container, tile, view };
        render();
      },
      hide: () => {
        shown?.container.replaceChildren();
        shown = null;
        said = null;
        block = null;
      },
    },
    layer: {
      attach: (scene, view) => {
        watch(view);
        glow.attach(scene, view);
      },
      update: (view) => {
        watch(view);
        glow.update?.(view);
      },
    },
    glow,
    bagEntry,
    openMap,
    showWaiting,
    close: () => {
      waiting.length = 0;
      closeCard();
    },
    get debug() {
      return {
        card: carded?.id ?? null,
        block,
        said: said?.text ?? null,
        glowing: glow.glowing,
        bag: bagIds,
      };
    },
  };
}
