import {
  hexKey,
  type Hex,
  type HexKey,
  type MapView,
  type PublicRoad,
  type PublicTile,
  type Supply,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import type { BuildSource } from '../building/tile-build.js';
import { homeApi as realHomeApi } from '../home/home-api.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { buttonClass } from '../ui/button/button.js';
import { el, messageOf } from '../ui/dom.js';
import { roadApi, type RoadApi } from './road-api.js';
import { RoadField } from './road-field.js';
import { createRoadFeed, isWildIsleView } from './road-feed.js';
import {
  refundText,
  roadCardLevel,
  roadCards,
  roadCommandFor,
  ROAD_TEXT,
  takeUpRefund,
} from './road-model.js';
import {
  BRIDGE_ID,
  bridgeCards,
  bridgesOf,
  DOCK_ID,
  docksOf,
  dockCards,
  ferryReach,
  hasDock,
  nearestFarShore,
  supplyOf,
  TRAVEL_SPOT,
  TRAVEL_TEXT,
} from './travel-model.js';

// Roads, bridges and ferry docks on a Wild Isle (#621 W1-6), as one feature
// main.ts mounts: the roads' map layer (drawn from `GET /maps/:id/roads`), the
// Build sheet's road, dock and bridge cards, the tile panel's Take up and
// Ferry across, and the supply line other screens ask about. The server
// checks every cost and rule (CLAUDE.md rule 1); this shows and sends.

export interface RoadsOptions {
  /** Who is signed in. */
  me: () => string | null;
  /** Glide the camera to a tile (the ferry's far shore). */
  pan: (tile: Hex) => void;
  /** Ask for another frame (the scene changed outside a render). */
  invalidate: () => void;
  api?: RoadApi;
  homeApi?: Pick<typeof realHomeApi, 'place'>;
}

export interface RoadsDebug {
  readonly roads: number;
  readonly loaded: boolean;
  readonly ferry: number;
  /** Roads drawn per level (1–3), or null before the map is up. */
  readonly drawn: readonly number[] | null;
}

export interface Roads {
  /** The map layer: pass it to `createMapScreen({ layers })`. */
  readonly layer: MapLayer;
  /** Road and dock cards for a tile of mine, for the land Build sheet. */
  readonly buildSource: BuildSource;
  /** The bridge card for a river tile, for the water tile's Build sheet. */
  readonly bridgeSource: BuildSource;
  /** Take up a road, and Ferry across, in the land tile's panel. */
  readonly tileActions: TileActions;
  /** My supply line on a Wild Isle, or undefined on a Cozy Patch (or before the roads load). */
  supply: (view: MapView) => Supply | undefined;
  /** The roads the client has now. */
  readonly roads: () => readonly PublicRoad[];
  readonly debug: RoadsDebug;
}

type Mode = 'card' | 'confirm';

export function createRoads(options: RoadsOptions): Roads {
  const api = options.api ?? roadApi;
  const home = options.homeApi ?? realHomeApi;
  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  let view: MapView | null = null;
  let field: RoadField | null = null;
  const listeners: (() => void)[] = [];
  /** Bumped when the map changes, so a late answer to an old map is dropped. */
  let generation = 0;
  let mapId: string | null = null;

  // The panel on screen (a tile of mine), and the ferry shown for its dock.
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let mode: Mode = 'card';
  let note = '';
  let working = false;
  let ferry: { dock: Hex; tiles: readonly PublicTile[] } | null = null;

  const tell = () => {
    for (const listener of listeners) listener();
  };

  const feed = createRoadFeed(
    (id) => api.list(id),
    () => {
      draw();
      render();
      tell();
    },
  );

  const byKey = (v: MapView): Map<HexKey, PublicTile> =>
    new Map(v.tiles.map((t) => [hexKey(t), t]));

  function draw(): void {
    if (!field || !view || !isWildIsleView(view)) return;
    const joins = [...bridgesOf(view.tiles), ...docksOf(view.tiles)].map(hexKey);
    field.drawRoads(feed.roads, byKey(view), joins);
    field.drawFerry(ferry?.tiles ?? []);
    options.invalidate();
  }

  const follow = (next: MapView): void => {
    if (next.map.id !== mapId) {
      mapId = next.map.id;
      generation += 1;
      clearFerry();
    }
    view = next;
    feed.follow(next);
    draw();
  };

  // The supply line, memoised on what it reads.
  let memo: { view: MapView; version: number; me: string; supply: Supply } | null = null;
  const supplyFor = (v: MapView): Supply | undefined => {
    const me = options.me();
    if (!me || !isWildIsleView(v) || !feed.loaded) return undefined;
    if (memo && memo.view === v && memo.version === feed.version && memo.me === me) {
      return memo.supply;
    }
    const supply = supplyOf(v, feed.roads, me);
    memo = { view: v, version: feed.version, me, supply };
    return supply;
  };

  const myRoad = (tile: Hex, me: string | null): PublicRoad | null =>
    me === null
      ? null
      : (feed.roads.find((r) => r.q === tile.q && r.r === tile.r && r.ownerUserId === me) ?? null);

  const landCards = (tile: PublicTile, v: MapView): BuildCard[] => {
    view = v;
    const me = options.me();
    if (!isWildIsleView(v) || !me || tile.ownerUserId !== me) return [];
    const supply = supplyFor(v);
    const supplied = supply ? supply.supplied : null;
    return [
      ...roadCards({
        tile,
        me,
        level: myRoad(tile, me)?.level ?? null,
        supplied: supplied ? supplied.has(hexKey(tile)) : null,
      }),
      ...dockCards({ tile, view: v, me, supplied }),
    ];
  };

  const waterCards = (tile: PublicTile, v: MapView): BuildCard[] => {
    view = v;
    const me = options.me();
    if (!isWildIsleView(v) || !me) return [];
    const supply = supplyFor(v);
    return bridgeCards({ tile, view: v, me, supplied: supply ? supply.supplied : null });
  };

  const sourceOf = (cards: (tile: PublicTile, v: MapView) => BuildCard[]): BuildSource => ({
    cards,
    bag: async () => {
      if (!mapId) throw new Error('no map');
      return api.items(mapId);
    },
    build: async (card, tile) => {
      const id = mapId;
      const me = options.me();
      if (!id || !me) return null;
      const at = generation;
      const stillHere = () => at === generation && mapId === id;
      const level = roadCardLevel(card.id);
      if (level !== null) {
        const res = await sendCommand(
          sendDeps,
          (key) => api.act(id, roadCommandFor(level), { q: tile.q, r: tile.r }, key),
          stillHere,
        );
        if (!res || !stillHere()) return null;
        feed.apply(res, me);
        return ROAD_TEXT.built(level);
      }
      if (card.id !== BRIDGE_ID && card.id !== DOCK_ID) return null;
      const res = await sendCommand(
        sendDeps,
        (key) =>
          home.place(id, { buildingId: card.id, q: tile.q, r: tile.r, spot: TRAVEL_SPOT }, key),
        stillHere,
      );
      if (!res || !stillHere()) return null;
      return card.id === BRIDGE_ID ? TRAVEL_TEXT.bridgeBuilt : TRAVEL_TEXT.dockBuilt;
    },
    onChange: (listener) => {
      listeners.push(listener);
    },
  });

  // --- The land tile's panel: Take up the road, and Ferry across. ---

  function clearFerry(): void {
    if (!ferry) return;
    ferry = null;
    field?.drawFerry([]);
    options.invalidate();
  }

  function showFerry(tile: PublicTile, v: MapView): void {
    const reach = ferryReach(v, tile);
    const tiles = v.tiles.filter((t) => reach.has(hexKey(t)));
    if (tiles.length === 0) {
      note = TRAVEL_TEXT.ferryNowhere;
      return;
    }
    ferry = { dock: { q: tile.q, r: tile.r }, tiles };
    field?.drawFerry(tiles);
    options.invalidate();
    const target = nearestFarShore(reach, tile, supplyFor(v)?.supplied ?? null);
    if (target) options.pan(target);
  }

  async function takeUp(): Promise<void> {
    if (!panel || working || !mapId) return;
    const id = mapId;
    const me = options.me();
    const { tile } = panel;
    if (!me) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      const res = await sendCommand(
        sendDeps,
        (key) => api.act(id, 'remove', { q: tile.q, r: tile.r }, key),
        stillHere,
      );
      if (res && stillHere()) {
        feed.apply(res, me);
        note = ROAD_TEXT.tookUp(refundText(res.refund));
      }
    } catch (err) {
      if (stillHere()) note = messageOf(err);
    } finally {
      working = false;
      mode = 'card';
      if (stillHere()) render();
    }
  }

  function render(): void {
    if (!panel) return;
    const { container, tile, view: v } = panel;
    const me = options.me();
    const parts: HTMLElement[] = [];
    const say = (text: string, testId?: string) =>
      el('p', { class: 'tile-action-note', ...(testId ? { 'data-testid': testId } : {}) }, text);
    const button = (label: string, testId: string, onClick: () => void, soft = false) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: `${buttonClass({ variant: soft ? 'secondary' : 'primary' })} bag-action`,
          'data-testid': testId,
        },
        label,
      );
      b.disabled = working;
      b.addEventListener('click', onClick);
      return b;
    };
    const road = isWildIsleView(v) ? myRoad(tile, me) : null;
    if (road) {
      parts.push(say(ROAD_TEXT.line(road.level), 'road-line'));
      if (mode === 'confirm') {
        parts.push(
          say(ROAD_TEXT.takeUpAsk(refundText(takeUpRefund(road.level))), 'road-confirm'),
          button(ROAD_TEXT.yes, 'road-take-up-yes', () => void takeUp()),
          button(
            ROAD_TEXT.keep,
            'road-keep',
            () => {
              mode = 'card';
              render();
            },
            true,
          ),
        );
      } else {
        parts.push(
          button(
            ROAD_TEXT.takeUp,
            'road-take-up',
            () => {
              mode = 'confirm';
              note = '';
              render();
            },
            true,
          ),
        );
      }
    }
    if (isWildIsleView(v) && hasDock(tile, me)) {
      const showing = ferry !== null && ferry.dock.q === tile.q && ferry.dock.r === tile.r;
      if (showing) parts.push(say(TRAVEL_TEXT.ferryReach, 'ferry-reach'));
      parts.push(
        button(
          showing ? TRAVEL_TEXT.ferryHide : TRAVEL_TEXT.ferryAcross,
          'ferry-across',
          () => {
            note = '';
            if (showing) clearFerry();
            else showFerry(tile, v);
            render();
          },
          true,
        ),
      );
    }
    if (note) parts.push(say(note, 'road-note'));
    container.replaceChildren(...parts);
  }

  const tileActions: TileActions = {
    show: (container, tile, next) => {
      const same = panel?.tile.q === tile.q && panel.tile.r === tile.r;
      if (!same) {
        mode = 'card';
        note = '';
        if (ferry && (ferry.dock.q !== tile.q || ferry.dock.r !== tile.r)) clearFerry();
      }
      panel = { container, tile, view: next };
      render();
    },
    hide: () => {
      panel?.container.replaceChildren();
      panel = null;
      mode = 'card';
      note = '';
      clearFerry();
    },
  };

  const layer: MapLayer = {
    attach: (scene, next) => {
      field = new RoadField(scene);
      ferry = null;
      scene.onDisposeObservable.addOnce(() => {
        field = null;
      });
      follow(next);
    },
    update: (next) => {
      follow(next);
    },
  };

  return {
    layer,
    buildSource: sourceOf(landCards),
    bridgeSource: sourceOf(waterCards),
    tileActions,
    supply: supplyFor,
    roads: () => feed.roads,
    get debug() {
      return {
        roads: feed.roads.length,
        loaded: feed.loaded,
        ferry: ferry?.tiles.length ?? 0,
        drawn: field ? field.debug.roads.slice() : null,
      };
    },
  };
}
