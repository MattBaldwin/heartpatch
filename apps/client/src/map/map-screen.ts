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
import { CAMERA, type QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import {
  createWsClient,
  type WsClient,
  type WsClientOptions,
  type WsStatus,
} from '../net/ws-client.js';
import type { GroundPoint } from '../engine/camera/camera-math.js';
import { el } from '../ui/dom.js';
import { greyTiles, hollowedTileInfo } from '../hollowed/community-model.js';
import { HEX_SIZE } from './map-config.js';
import { mapApi } from './map-api.js';
import { AmbientDriver } from './ambient-driver.js';
import { isHalloween, isWaterTile, seasonsOn } from './map-dressing.js';
import { mountMapLegend } from './map-legend.js';
import { createPatchStatsScreen } from './patch-stats-screen.js';
import type { BuildAreaView } from './build-area.js';
import type { BuildAreaHit } from './build-area-layout.js';
import { MapScene, type MapSceneStats, type ScreenRect } from './map-scene.js';
import type { MapState } from './map-state.js';
import type { TileInfo } from './tile-info.js';
import { MapSync } from './map-sync.js';
import { maxZoomFor } from './map-layout.js';
import { listenForTaps } from './tap-detector.js';
import { seedName } from '../home/home-name-view.js';
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
  /**
   * Now on the game clock, for the season by the map's local date (Halloween
   * dressing): main passes the bag's, the server's time (#583), so a phone
   * whose clock is off dresses the map as the server's season says.
   */
  now?: () => Date;
  /** The map closed by itself (e.g. the player was removed): show the lobby with this. */
  onClosed: (message: string) => void;
  api?: { view: (mapId: string) => Promise<MapView> };
  /**
   * Syncs the game clock (`now`) for a map, read alongside its view so the
   * first build is dressed for the server's season (#583). Never rejects.
   */
  syncClock?: (mapId: string) => Promise<void>;
  createWs?: (options: WsClientOptions) => WsClient;
  /** Buttons for the tapped tile, drawn into the tile panel (gathering, #17). */
  tileActions?: TileActions;
  /** Features that draw over the map (the night and the Hollow Man, #21). */
  layers?: readonly MapLayer[];
  /** Small things at the end of the patch-name card's row (the 💛 Heart Coin pill, #601). */
  hudExtras?: readonly HTMLElement[];
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

/** The middle of a screen rect, or null when there is none. */
function homeNodeMiddle(
  rect: { x: number; y: number; width: number; height: number } | null,
): { x: number; y: number } | null {
  return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
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
  /** Each open home's Heart Seed spot on screen (CSS pixels), for e2e taps (#318). */
  readonly openHomes: readonly { key: HexKey; x: number; y: number }[];
  /** The middle of this player's home node tile on screen (CSS pixels), for e2e taps (#429); null off screen. */
  readonly homeNode: { x: number; y: number } | null;
  /** Builds since the map was opened: 1 unless something rebuilt it (a reseason, #583). */
  readonly builds: number;
}

export interface MapScreen {
  /** Fetches and shows a map; rejects (with a player-safe message) if it can't. */
  open: (mapId: string) => Promise<void>;
  /**
   * Takes the map off screen but keeps following it live (#29): a live
   * battle needs this patch's events (the other Keeper's picks and cheers),
   * and the server counts a subscribed socket as "here". `open` brings it back.
   */
  hide: () => void;
  /** Back to the default scene; stops live updates. */
  close: () => void;
  /**
   * Taps a tile for the player ("Find on map" in the recipe book): selects it
   * and shows its chip. Returns where it is on the ground, for the camera to
   * glide to, or null when it isn't on the map on screen.
   */
  focus: (h: Hex) => GroundPoint | null;
  /**
   * Dev hook only (e2e): plays one live event into the open map as if the
   * server had sent it, e.g. a capture of land the server already counts as
   * a homestead (#242). Ignored with no map open.
   */
  replay: (event: WsEventMessage) => void;
  /**
   * A tile's box on screen now (CSS pixels, #419), or null with no map on
   * screen or the tile behind the camera. A tile panned past the edge gives
   * a box off screen: callers check.
   */
  tileRect: (h: Hex) => ScreenRect | null;
  /** My home base's node on screen now, or null (#419: where things made at home fly from). */
  homeRect: () => ScreenRect | null;
  /** The tile a building stands on, by its instance id, or null (#419: a Factory's batches fly from there). */
  buildingTile: (id: string) => Hex | null;
  /**
   * Lights the edges or middle of a tile for the Build sheet (#371) and sends
   * taps on them to `onTap`; null puts them out. Taps elsewhere work as ever.
   */
  setBuildArea: (
    area: { view: Omit<BuildAreaView, 'top'>; onTap: (hit: BuildAreaHit) => void } | null,
  ) => void;
  /** Clears the selected tile and shuts its panel (a screen opened from it, like a trading post's, #271). */
  deselect: () => void;
  /** The map on screen as this player sees it, or null (the recipe book finds their tiles in it). */
  readonly view: MapView | null;
  setUser: (user: PublicUser | null) => void;
  /** Night on the map (#21): fireflies, the night backdrop, lanterns glowing. */
  setNight: (night: boolean) => void;
  /**
   * The game clock moved (#583): if the map's seasons are no longer the ones
   * it was dressed for (a first sync after a cold start, or a season's
   * window closing), it's built again in the new dressing.
   */
  reseason: () => void;
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
  /**
   * Trick-or-treat (#515): patch-mates on map `mapId` with a lit
   * Jack-o'-Lantern tonight get a porch lantern by their Heart Seed. A reply
   * for another map is ignored.
   */
  setPorchLanterns: (mapId: string, userIds: ReadonlySet<string>) => void;
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
  /** What the Build sheet has lit on the selected tile, and who hears the taps (#371). */
  let buildArea: Parameters<MapScreen['setBuildArea']>[0] = null;
  /** Followed live while another screen is up (`hide`, a live battle). */
  let backgrounded = false;
  let night = false;
  /** The seasons the map was last dressed for, and whether that scene is still on the stage. */
  let dressedFor: string | null = null;
  let onStage = false;
  /** A map is being fetched to open: its own build dresses it (no reseason meanwhile). */
  let opening = false;
  /** Builds since the map was opened (the dev hook reads it). */
  let builds = 0;
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
  /** The porch lanterns for the map on screen (#515). */
  let porches: { mapId: string; userIds: ReadonlySet<string> } | null = null;
  const drawPorches = (): void => {
    const state = sync.state;
    if (!scene3d || !state) return;
    scene3d.setPorchLanterns(porches?.mapId === state.id ? porches.userIds : new Set());
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
  const hudTitle = el(
    'div',
    { class: 'map-hud-title' },
    hudName,
    legendButton,
    ...(options.hudExtras ?? []),
  );
  const setLegend = (open: boolean): void => {
    legend.setOpen(open);
    legendButton.setAttribute('aria-expanded', legend.open ? 'true' : 'false');
  };
  const showLegend = (view: MapView): void => {
    // The grey villages' swatch (#306) while the map has any.
    legend.show(view.members, user?.id ?? null, greyTiles(view).size > 0);
    // Nobody's land to tell apart: no icons, and nothing to open.
    legendButton.hidden = legend.icons.childElementCount === 0;
  };
  legendButton.addEventListener('click', () => {
    setLegend(!legend.open);
  });
  // Who's winning what (#573): from the legend card, so the top bar stays as
  // it is. First in the card, clear of the side trays' handles on a small phone.
  const stats = createPatchStatsScreen({ root: options.root });
  const statsButton = el(
    'button',
    { type: 'button', class: 'map-legend-stats', 'data-testid': 'map-legend-stats' },
    '👑 Patch stats',
  );
  statsButton.addEventListener('click', () => {
    const state = sync.state;
    setLegend(false);
    if (state) stats.show(state.id, user?.id ?? null);
  });
  legend.card.prepend(statsButton);
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
    buildArea = null;
    scene3d?.showBuildArea(null);
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
    // Another tile opens at its title, not where the last one was scrolled to.
    const another = selected === null || hexKey(selected) !== hexKey(h);
    selected = h;
    scene3d?.select(h);
    // A Hollowed village's tile says so in its head (#306).
    const show = (info: TileInfo): void => {
      panel.show(hollowedTileInfo(info, tile, state.view, user?.id ?? null));
    };
    show(
      describeTile(
        tile,
        (id) => state.member(id),
        user?.id ?? null,
        seasonsOn(state.view.map.timeZone, options.now?.() ?? new Date()),
        isTradingPost(tile) && user ? postReach(tile, state.view.tiles, user.id) : null,
        seedName(state.view, tile),
      ),
    );
    // Water (Wild Isle, #621) can't be claimed or explored. (W1-5b/W1-6: a
    // bridge or dock action on a river or lake tile goes through here.)
    if (isWaterTile(tile)) options.tileActions?.hide();
    else options.tileActions?.show(panel.actions, tile, state.view);
    if (another) panel.toTop();
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
      // Followed in the background (`hide`): the state is kept, nothing is drawn.
      if (backgrounded) return;
      const drawn = drawnView(state.view);
      scene3d?.update(drawn);
      showLegend(state.view);
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
    const seasons = seasonsOn(state.view.map.timeZone, at);
    dressedFor = seasons.join();
    builds += 1;
    const built = new MapScene(scene, drawn, {
      halloween: isHalloween(state.view.map.timeZone, at),
      seasons,
      ...ambient.state,
    });
    onStage = true;
    built.setNight(night);
    built.setLandFade(landFade);
    scene3d = built;
    drawWild();
    drawPorches();
    ambient.start();
    // Another screen (a battle, a close-up) swapped the stage: stop asking for
    // frames until the map is built again.
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d !== built) return;
      ambient.stop();
      onStage = false;
    });
    for (const layer of options.layers ?? []) layer.attach(scene, drawn);
    if (selected) built.select(selected);
    built.showBuildArea(buildArea?.view ?? null);
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
          const hit = buildArea ? built.pickBuildArea(x, y) : null;
          if (buildArea && hit) {
            buildArea.onTap(hit);
            return;
          }
          const tile = built.pick(x, y);
          const current = sync.state;
          if (tile && current) showTile(current, tile);
          else deselect();
        },
        stop.signal,
      );
    }
    return {
      bounds: built.bounds,
      start: built.homeOf(state.view, user?.id ?? null),
      maxDistance: maxZoomFor(built.bounds, CAMERA.maxDistance),
    };
  };

  /** Takes the map off screen (the sync is already closed or about to be). */
  function hideMap(): void {
    ambient.stop();
    scene3d = null;
    selected = null;
    buildArea = null;
    panel.hide();
    options.tileActions?.hide();
    setLegend(false);
    stats.close();
    hud.hidden = true;
    options.onHudChange?.(null);
    options.showScene(null);
  }

  const close = (): void => {
    backgrounded = false;
    sync.close();
    hideMap();
  };

  /**
   * Builds the map on screen afresh: the tile panel closes and the stage is
   * mounted again (the camera goes home). `reseason` does this only when the
   * seasons really changed (a window closing mid-visit).
   */
  const rebuild = (): void => {
    scene3d = null;
    selected = null;
    panel.hide();
    options.tileActions?.hide();
    options.showScene(build);
  };

  return {
    hide: () => {
      backgrounded = true;
      hideMap();
    },
    open: async (mapId) => {
      backgrounded = false;
      opening = true;
      let state: Awaited<ReturnType<typeof sync.open>>;
      try {
        [state] = await Promise.all([sync.open(mapId), options.syncClock?.(mapId)]);
      } finally {
        opening = false;
      }
      if (!state) return;
      builds = 0;
      rebuild();
      hudName.textContent = state.view.map.name;
      showLegend(state.view);
      hud.hidden = false;
      options.onHudChange?.(state.id);
      setStatus(liveSocket().status);
    },
    close,
    deselect,
    setBuildArea: (next) => {
      buildArea = next;
      scene3d?.showBuildArea(next?.view ?? null);
      options.invalidate();
    },
    replay: (event) => {
      sync.event(event);
    },
    focus: (h) => {
      const state = sync.state;
      if (!state || !scene3d || !state.tileAt(hexKey(h))) return null;
      showTile(state, h);
      const p = hexToWorld(h, HEX_SIZE);
      return { x: p.x, z: p.z };
    },
    // Only while the map is on screen: another screen (home, a battle) owns the stage then.
    tileRect: (h) => (hud.hidden ? null : (scene3d?.tileRect(h) ?? null)),
    homeRect: () => (hud.hidden ? null : (scene3d?.homeNodeRect(user?.id ?? null) ?? null)),
    buildingTile: (id) => scene3d?.buildingTile(id) ?? null,
    setNight: (next) => {
      night = next;
      scene3d?.setNight(next);
      options.invalidate();
    },
    reseason: () => {
      const state = sync.state;
      // Another screen on the stage: the map is dressed afresh when it's built again.
      if (!state || !scene3d || !onStage || backgrounded || opening) return;
      const at = options.now?.() ?? new Date();
      if (seasonsOn(state.view.map.timeZone, at).join() !== dressedFor) rebuild();
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
    setPorchLanterns: (mapId, userIds) => {
      porches = { mapId, userIds: new Set(userIds) };
      drawPorches();
      options.invalidate();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      wild = null;
      porches = null;
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
        // Open homes on screen (#318), to tap in e2e.
        openHomes: scene3d.openHomeRects().map(({ key, rect }) => ({
          key,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        })),
        homeNode: homeNodeMiddle(scene3d.homeNodeRect(user?.id ?? null)),
        builds,
      };
    },
  };
}
