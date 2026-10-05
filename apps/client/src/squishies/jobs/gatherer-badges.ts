import type { Scene } from '@babylonjs/core/scene';
import {
  GAME_EVENTS,
  hexKey,
  type HexKey,
  type MapView,
  type PublicTile,
  type WsEventMessage,
} from '@heartpatch/shared';
import { tileScreenRectOf } from '../../map/map-scene.js';
import type { MapLayer } from '../../map/map-screen.js';
import { el } from '../../ui/dom.js';

// A little 🧺 over every tile where a squishy is gathering (squishy jobs), as
// a DOM overlay placed with the map's one tile projection (`tileScreenRectOf`),
// so the 3D scene stays the terrain lane's. Badges move only when a frame is
// drawn (frames are drawn on demand) and touch the DOM only when they moved.

export interface GathererBadges extends MapLayer {
  /** A live event the map saw (`squishy.assigned` moves a badge; a capture drops it). */
  liveEvent: (event: WsEventMessage) => void;
  /** Badges on screen now (the dev hook). */
  readonly shown: number;
}

interface Badge {
  tile: PublicTile;
  count: number;
  node: HTMLElement;
  /** Where it was last put, so an unmoved badge writes nothing. */
  at: string;
}

export function createGathererBadges(root: HTMLElement): GathererBadges {
  let scene: Scene | null = null;
  let tiles = new Map<HexKey, PublicTile>();
  const badges = new Map<HexKey, Badge>();

  const place = (badge: Badge) => {
    const rect = scene ? tileScreenRectOf(scene, badge.tile) : null;
    const at = rect
      ? `${String(Math.round(rect.x + rect.width / 2))},${String(Math.round(rect.y))}`
      : 'hidden';
    if (at === badge.at) return;
    badge.at = at;
    badge.node.hidden = rect === null;
    if (rect) {
      badge.node.style.transform = `translate(${String(Math.round(rect.x + rect.width / 2))}px, ${String(Math.round(rect.y))}px) translate(-50%, -100%)`;
    }
  };
  const placeAll = () => {
    for (const badge of badges.values()) place(badge);
  };

  const setCount = (key: HexKey, count: number) => {
    const tile = tiles.get(key);
    const badge = badges.get(key);
    if (!tile || count <= 0) {
      badge?.node.remove();
      badges.delete(key);
      return;
    }
    if (badge) {
      badge.count = count;
      badge.node.textContent = count > 1 ? `🧺${String(count)}` : '🧺';
      return;
    }
    const node = el(
      'div',
      { class: 'gatherer-badge', 'aria-hidden': 'true', 'data-testid': 'gatherer-badge' },
      count > 1 ? `🧺${String(count)}` : '🧺',
    );
    node.hidden = true;
    root.append(node);
    const added = { tile, count, node, at: '' };
    badges.set(key, added);
    place(added);
  };

  const clear = () => {
    for (const badge of badges.values()) badge.node.remove();
    badges.clear();
  };

  return {
    attach: (next: Scene, view: MapView) => {
      clear();
      scene = next;
      tiles = new Map(view.tiles.map((t) => [hexKey(t), t]));
      for (const tile of view.tiles) {
        if ((tile.workers ?? 0) > 0) setCount(hexKey(tile), tile.workers ?? 0);
      }
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        clear();
      });
    },
    liveEvent: (event) => {
      if (!scene) return;
      if (event.type === 'squishy.assigned') {
        const parsed = GAME_EVENTS['squishy.assigned'].public.safeParse(event.data);
        if (!parsed.success) return;
        const { from, to } = parsed.data;
        if (from) setCount(hexKey(from), (badges.get(hexKey(from))?.count ?? 0) - 1);
        if (to) setCount(hexKey(to), (badges.get(hexKey(to))?.count ?? 0) + 1);
      } else if (event.type === 'tile.captured') {
        // The old owner's gatherer there stopped.
        const parsed = GAME_EVENTS['tile.captured'].public.safeParse(event.data);
        if (parsed.success) setCount(hexKey(parsed.data), 0);
      }
    },
    get shown() {
      return [...badges.values()].filter((b) => !b.node.hidden).length;
    },
  };
}
