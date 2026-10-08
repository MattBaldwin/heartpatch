import {
  hexKey,
  hexToWorld,
  isTradingPost,
  postReach,
  type Hex,
  type HexKey,
  type HighlightTarget,
  type MapView,
  type PublicTile,
  type PublicUser,
  type WsEventMessage,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import {
  createWsClient,
  type WsClient,
  type WsClientOptions,
  type WsStatus,
} from '../net/ws-client.js';
import type { GroundPoint } from '../engine/camera/camera-math.js';
import { el } from '../ui/dom.js';
import { HEX_SIZE } from './map-config.js';
import { mapApi } from './map-api.js';
import { AmbientDriver } from './ambient-driver.js';
import { isHalloween, seasonsOn } from './map-dressing.js';
import { mountMapLegend } from './map-legend.js';
import { MapScene, type MapSceneStats, type ScreenRect } from './map-scene.js';
import type { MapState } from './map-state.js';
import { MapSync } from './map-sync.js';
import { listenForTaps } from './tap-detector.js';
import { describeTile } from './tile-info.js';
import { mountTilePanel } from './tile-panel.js';
import { wildMarkers } from './wild-markers.js';
import './map.css';

// The map screen (#7, live updates from #22): draws the open map, keeps it
// live (map-sync.ts), and shows tile info on tap. The client only draws what
// the server sends (CLAUDE.md rule 1).

export interface MapScreenOptions {
  root: HTMLElement;
  /** Puts a scene on screen: the map's, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  /** Draws one frame (`Stage.requestFrame`): ambient life paces itself with this. */
  requestFrame?: () => void;
  /** The quality tier now: the low tier drops ambient life (motes and motion). */
  tier?: () => QualityTier;
  /** Now, for the season by the map's local date (Halloween dressing). */
  now?: () => Date;
  /** The map closed by itself (e.g. the player was removed): show the lobby with this. */
  onClosed: (message: string) => void;
  api?: { view: (mapId: string) => Promise<MapView> };
  createWs?: (options: WsClientOptions) => WsClient;
  /** Buttons for the tapped tile, drawn into the tile panel (gathering, #17). */
  tileActions?: TileActions;
  /** Features that draw over the map (the night and the Hollow Man, #21). */
  layers?: readonly MapLayer[];
  /** The map's HUD came on screen (its id) or went away (null): the side trays follow it (ui/trays). */
  onHudChange?: (mapId: string | null) => void;
  /** Every live event the socket delivers, in seq order, after the map saw it (a find, #43). */
  onLiveEvent?: (event: WsEventMessage) => void;
  /**
   * Where the tutorial's spotlight finds things drawn on the map
   * (`TutorialScreen.targets`): the player's home node, for the gather step.
   */
  targets?: {
    register: (target: HighlightTarget, locate: () => ScreenRect | null) => () => void;
  };
}

/** A feature that adds to the map's scene (#21: night lighting and the Hollow Man). */
export interface MapLayer {
  /**
   * The map was built into a fresh `scene` (on open, and again after a
   * GPU-loss rebuild). Disposed with the scene; `scene.onDisposeObservable`
   * says when.
   */
  attach: (scene: Scene, view: MapView) => void;
  /** The map redrew from a newer view (a live event, or a resync's refetch). */
  update?: (view: MapView) => void;
}

/** A feature's buttons in the tile panel. */
export interface TileActions {
  /**
   * The panel shows `tile` (on tap, and again when the map redraws). `view`
   * is the whole map as this player has it now (neighbours, owners, PvP mode).
   */
  show: (container: HTMLElement, tile: PublicTile, view: MapView) => void;
  /** The panel closed. */
  hide: () => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface MapDebug extends MapSceneStats {
  readonly id: string;
  /** The seq of the last map view fetched (live events move on from there). */
  readonly viewSeq: number;
  readonly selected: string | null;
  readonly live: WsStatus | null;
  /** Each wild-squishy tuft's tile and its middle on screen (CSS pixels), for e2e taps (#209). */
  readonly wild: readonly { key: HexKey; x: number; y: number }[];
}

export interface MapScreen {
  /** Fetches and shows a map; rejects (with a player-safe message) if it can't. */
  open: (mapId: string) => Promise<void>;
  /** Back to the default scene; stops live updates. */
  close: () => void;
  /**
   * Taps a tile for the player ("Find on map" in the recipe book): selects it
   * and shows its chip. Returns where it is on the ground, for the camera to
   * glide to, or null when it isn't on the map on screen.
   */
  focus: (h: Hex) => GroundPoint | null;
  /** The map on screen as this player sees it, or null (the recipe book finds their tiles in it). */
  readonly view: MapView | null;
  setUser: (user: PublicUser | null) => void;
  /** Night on the map (#21): fireflies, the night backdrop, lanterns glowing. */
  setNight: (night: boolean) => void;
  /** My land that misses me (owner decision 2026-10-06): each fading tile's share, 0–1. */
  setLandFade: (fade: ReadonlyMap<HexKey, number>) => void;
  /**
   * The night show (#277): land the Hollow Man won back at nightfall is drawn
   * as its Keeper's (tile → their user id) until his strike lands in the
   * show. Only the drawing: the tile panel and everything else see the land
   * as it is.
   */
  setHeld: (held: ReadonlyMap<HexKey, string>) => void;
  /**
   * Tiles in reach with a wild squishy this window (#209, the server's
   * `wildHints`: tiles only, no species) for map `mapId`: each gets a
   * rustling tuft. A reply for another map is ignored.
   */
  setWild: (mapId: string, tiles: readonly Hex[]) => void;
  readonly debug: MapDebug | null;
}

const STATUS_TEXT: Partial<Record<WsStatus, string>> = {
  reconnecting: 'Reconnecting…',
  'logged-out': 'You got logged out.',
};

export function createMapScreen(options: MapScreenOptions): MapScreen {
  const api = options.api ?? mapApi;
  const createWs = options.createWs ?? createWsClient;

  let user: PublicUser | null = null;
  let scene3d: MapScene | null = null;
  let ws: WsClient | null = null;
  let selected: Hex | null = null;
  let night = false;
  let landFade: ReadonlyMap<HexKey, number> = new Map();
  let held: ReadonlyMap<HexKey, string> = new Map();
  /** The view as drawn: held land still its Keeper's (#277), only while it's wild. */
  const drawnView = (view: MapView): MapView =>
    held.size === 0
      ? view
      : {
          ...view,
          tiles: view.tiles.map((t) => {
            const owner = held.get(hexKey(t));
            return owner !== undefined && t.ownerUserId === null
              ? { ...t, ownerUserId: owner, guardianHint: null }
              : t;
          }),
        };
  /** The wild hints for the map on screen (#209). */
  let wild: { mapId: string; tiles: readonly Hex[] } | null = null;
  const drawWild = (): void => {
    const state = sync.state;
    if (!scene3d || !state) return;
    const tiles = wild?.mapId === state.id ? wild.tiles : [];
    scene3d.setWild(wildMarkers(tiles, (key) => state.tileAt(key)));
  };

  const hudName = el('span', { class: 'map-hud-name' });
  // Whose land is whose (#278): each Keeper's icon beside the name opens
  // the legend card (the whole name row is its tap); any other tap closes it.
  // The button's name is its own, never the patch's, so a patch named
  // "Collect Patch" doesn't make a button that reads "Collect".
  const legend = mountMapLegend();
  const legendButton = el(
    'button',
    {
      type: 'button',
      class: 'map-hud-legend',
      'aria-label': 'Whose land?',
      'aria-controls': 'map-legend',
      'aria-expanded': 'false',
      'data-testid': 'map-legend-button',
    },
    legend.icons,
  );
  const hudTitle = el('div', { class: 'map-hud-title' }, hudName, legendButton);
  const setLegend = (open: boolean): void => {
    legend.setOpen(open);
    legendButton.setAttribute('aria-expanded', legend.open ? 'true' : 'false');
  };
  const showLegend = (members: MapView['members']): void => {
    legend.show(members, user?.id ?? null);
    // Nobody's land to tell apart: no icons, and nothing to open.
    legendButton.hidden = legend.icons.childElementCount === 0;
  };
  legendButton.addEventListener('click', () => {
    setLegend(!legend.open);
  });
  // Once for the app's life: the map screen is made once (main.ts).
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!legend.open || !(e.target instanceof Node)) return;
      if (legendButton.contains(e.target) || legend.card.contains(e.target)) return;
      setLegend(false);
    },
    { capture: true },
  );
  const hudStatus = el('span', { class: 'map-hud-status', role: 'status' });
  const login = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-small map-hud-login' },
    'Log in again',
  );
  login.addEventListener('click', () => {
    window.location.reload();
  });
  const hud = el(
    'div',
    { class: 'map-hud', 'data-testid': 'map-hud' },
    hudTitle,
    hudStatus,
    login,
    legend.card,
  );
  hud.hidden = true;
  options.root.append(hud);

  const setStatus = (status: WsStatus): void => {
    const text = STATUS_TEXT[status];
    hudStatus.textContent = text ?? '';
    hudStatus.hidden = text === undefined;
    login.hidden = status !== 'logged-out';
  };

  const deselect = (): void => {
    selected = null;
    scene3d?.select(null);
    panel.hide();
    options.tileActions?.hide();
    options.invalidate();
  };
  const panel = mountTilePanel(options.root, deselect);

  const showTile = (state: MapState, h: Hex): void => {
    const tile = state.tileAt(hexKey(h));
    if (!tile) {
      deselect();
      return;
    }
    selected = h;
    scene3d?.select(h);
    panel.show(
      describeTile(
        tile,
        (id) => state.member(id),
        user?.id ?? null,
        seasonsOn(state.view.map.timeZone, options.now?.() ?? new Date()),
        isTradingPost(tile) && user ? postReach(tile, state.view.tiles, user.id) : null,
      ),
    );
    options.tileActions?.show(panel.actions, tile, state.view);
    options.invalidate();
  };

  const liveSocket = (): WsClient => {
    ws ??= createWs({
      onEvent: (event) => {
        sync.event(event);
        options.onLiveEvent?.(event);
      },
      onResync: (mapId) => {
        sync.serverResync(mapId);
      },
      onError: (error) => {
        sync.serverError(error);
      },
      onStatus: setStatus,
    });
    return ws;
  };

  const sync = new MapSync({
    fetchView: (mapId) => api.view(mapId),
    socket: liveSocket,
    onRedraw: (state) => {
      const drawn = drawnView(state.view);
      scene3d?.update(drawn);
      showLegend(state.view.members);
      drawWild();
      for (const layer of options.layers ?? []) layer.update?.(drawn);
      if (selected) showTile(state, selected);
      options.invalidate();
    },
    onLeave: (message) => {
      hideMap();
      options.onClosed(message);
    },
  });

  // Ambient life (the terrain visual pass): see ambient-driver.ts.
  const ambient = new AmbientDriver({
    target: () => scene3d,
    invalidate: options.invalidate,
    ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
    ...(options.tier ? { tier: options.tier } : {}),
  });

  /** Builds the map into a fresh scene (on open, and again after a GPU-loss rebuild). */
  const build = (scene: Scene): SceneContent => {
    const state = sync.state;
    if (!state) throw new Error('no map to build');
    const at = options.now?.() ?? new Date();
    const drawn = drawnView(state.view);
    const built = new MapScene(scene, drawn, {
      halloween: isHalloween(state.view.map.timeZone, at),
      seasons: seasonsOn(state.view.map.timeZone, at),
      ...ambient.state,
    });
    built.setNight(night);
    built.setLandFade(landFade);
    scene3d = built;
    drawWild();
    ambient.start();
    // Another screen (a battle, a close-up) swapped the stage: stop asking for
    // frames until the map is built again.
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d === built) ambient.stop();
    });
    for (const layer of options.layers ?? []) layer.attach(scene, drawn);
    if (selected) built.select(selected);
    const unregister = options.targets?.register('resource-node', () =>
      built.homeNodeRect(user?.id ?? null),
    );
    if (unregister) scene.onDisposeObservable.addOnce(unregister);
    const canvas = scene.getEngine().getRenderingCanvas();
    if (canvas) {
      const stop = new AbortController();
      scene.onDisposeObservable.addOnce(() => {
        stop.abort();
      });
      listenForTaps(
        canvas,
        (x, y) => {
          const tile = built.pick(x, y);
          const current = sync.state;
          if (tile && current) showTile(current, tile);
          else deselect();
        },
        stop.signal,
      );
    }
    return { bounds: built.bounds, start: built.homeOf(state.view, user?.id ?? null) };
  };

  /** Takes the map off screen (the sync is already closed or about to be). */
  function hideMap(): void {
    ambient.stop();
    scene3d = null;
    selected = null;
    panel.hide();
    options.tileActions?.hide();
    setLegend(false);
    hud.hidden = true;
    options.onHudChange?.(null);
    options.showScene(null);
  }

  const close = (): void => {
    sync.close();
    hideMap();
  };

  return {
    open: async (mapId) => {
      const state = await sync.open(mapId);
      if (!state) return;
      scene3d = null;
      selected = null;
      panel.hide();
      options.tileActions?.hide();
      options.showScene(build);
      hudName.textContent = state.view.map.name;
      showLegend(state.view.members);
      hud.hidden = false;
      options.onHudChange?.(state.id);
      setStatus(liveSocket().status);
    },
    close,
    focus: (h) => {
      const state = sync.state;
      if (!state || !scene3d || !state.tileAt(hexKey(h))) return null;
      showTile(state, h);
      const p = hexToWorld(h, HEX_SIZE);
      return { x: p.x, z: p.z };
    },
    setNight: (next) => {
      night = next;
      scene3d?.setNight(next);
      options.invalidate();
    },
    setLandFade: (next) => {
      landFade = next;
      scene3d?.setLandFade(next);
      options.invalidate();
    },
    setHeld: (next) => {
      if (next.size === 0 && held.size === 0) return;
      held = new Map(next);
      const state = sync.state;
      if (!state) return;
      const drawn = drawnView(state.view);
      scene3d?.update(drawn);
      for (const layer of options.layers ?? []) layer.update?.(drawn);
      options.invalidate();
    },
    setWild: (mapId, tiles) => {
      wild = { mapId, tiles };
      drawWild();
      options.invalidate();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      wild = null;
      if (sync.state) close();
      ws?.close();
      ws = null;
    },
    get view() {
      return scene3d ? (sync.state?.view ?? null) : null;
    },
    get debug() {
      const state = sync.state;
      if (!state || !scene3d) return null;
      return {
        id: state.id,
        viewSeq: state.view.seq,
        ...scene3d.stats,
        selected: selected ? hexKey(selected) : null,
        live: ws?.status ?? null,
        wild: scene3d.wildRects().map(({ key, rect }) => ({
          key,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        })),
      };
    },
  };
}
