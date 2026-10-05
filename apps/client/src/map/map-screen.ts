import {
  hexKey,
  hexToWorld,
  type Hex,
  type HighlightTarget,
  type MapView,
  type PublicTile,
  type PublicUser,
  type WsEventMessage,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
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
import { MapScene, type MapSceneStats, type ScreenRect } from './map-scene.js';
import type { MapState } from './map-state.js';
import { MapSync } from './map-sync.js';
import { listenForTaps } from './tap-detector.js';
import { describeTile } from './tile-info.js';
import { mountTilePanel } from './tile-panel.js';
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
  /** The map closed by itself (e.g. the player was removed): show the lobby with this. */
  onClosed: (message: string) => void;
  api?: { view: (mapId: string) => Promise<MapView> };
  createWs?: (options: WsClientOptions) => WsClient;
  /** Buttons for the tapped tile, drawn into the tile panel (gathering, #17). */
  tileActions?: TileActions;
  /** Features that draw over the map (the night and the Hollow Man, #21). */
  layers?: readonly MapLayer[];
  /** The map's HUD came on screen (true) or went away: the side trays follow it (ui/trays). */
  onHudChange?: (shown: boolean) => void;
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
  setUser: (user: PublicUser | null) => void;
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

  const hudName = el('span', { class: 'map-hud-name' });
  const hudStatus = el('span', { class: 'map-hud-status', role: 'status' });
  const login = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-small map-hud-login' },
    'Log in again',
  );
  login.addEventListener('click', () => {
    window.location.reload();
  });
  const hud = el('div', { class: 'map-hud', 'data-testid': 'map-hud' }, hudName, hudStatus, login);
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
    panel.show(describeTile(tile, (id) => state.member(id), user?.id ?? null));
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
      scene3d?.update(state.view);
      if (selected) showTile(state, selected);
      options.invalidate();
    },
    onLeave: (message) => {
      hideMap();
      options.onClosed(message);
    },
  });

  /** Builds the map into a fresh scene (on open, and again after a GPU-loss rebuild). */
  const build = (scene: Scene): SceneContent => {
    const state = sync.state;
    if (!state) throw new Error('no map to build');
    const built = new MapScene(scene, state.view);
    scene3d = built;
    for (const layer of options.layers ?? []) layer.attach(scene, state.view);
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
    scene3d = null;
    selected = null;
    panel.hide();
    options.tileActions?.hide();
    hud.hidden = true;
    options.onHudChange?.(false);
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
      hud.hidden = false;
      options.onHudChange?.(true);
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
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      if (sync.state) close();
      ws?.close();
      ws = null;
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
      };
    },
  };
}
