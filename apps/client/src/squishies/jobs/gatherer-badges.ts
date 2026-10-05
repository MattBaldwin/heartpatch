import type { Scene } from '@babylonjs/core/scene';
import { hexKey, type HexKey, type MapView, type PublicTile } from '@heartpatch/shared';
import { tileScreenRectOf } from '../../map/map-scene.js';
import type { MapLayer } from '../../map/map-screen.js';
import { el } from '../../ui/dom.js';

// A little 🧺 over every tile where a squishy is gathering (squishy jobs), as
// a DOM overlay placed with the map's one tile projection (`tileScreenRectOf`),
// so the 3D scene stays the terrain lane's. Drawn from the map's own view
// (`PublicTile.workers`, which `MapState` keeps live and a resync refetches),
// so it never keeps a second count. Badges move only when a frame is drawn
// (frames are drawn on demand) and touch the DOM only when they moved.

export interface GathererBadges extends MapLayer {
  /** Badges on screen now (the dev hook). */
  readonly shown: number;
}

interface Badge {
  tile: PublicTile;
  node: HTMLElement;
  /** Where and what it last showed, so an unchanged badge writes nothing. */
  at: string;
  label: string;
}

const labelOf = (count: number) => (count > 1 ? `🧺${String(count)}` : '🧺');
/** A badge's width before it has been laid out. */
const BADGE_MIN_WIDTH_PX = 32;

export function createGathererBadges(root: HTMLElement): GathererBadges {
  let scene: Scene | null = null;
  const badges = new Map<HexKey, Badge>();

  const place = (badge: Badge) => {
    const seen = scene ? tileScreenRectOf(scene, badge.tile) : null;
    // A tile the camera can't see, or that sits wholly off the screen, shows
    // no badge; one half off the edge keeps its badge just inside (#161).
    const rect =
      seen &&
      seen.x + seen.width > 0 &&
      seen.x < window.innerWidth &&
      seen.y + seen.height > 0 &&
      seen.y < window.innerHeight
        ? seen
        : null;
    const half = Math.max(badge.node.offsetWidth, BADGE_MIN_WIDTH_PX) / 2;
    const x = rect
      ? Math.round(Math.min(Math.max(rect.x + rect.width / 2, half), window.innerWidth - half))
      : 0;
    const y = rect ? Math.round(rect.y) : 0;
    const at = rect ? `${String(x)},${String(y)}` : 'hidden';
    if (at === badge.at) return;
    badge.at = at;
    badge.node.hidden = rect === null;
    if (rect) {
      badge.node.style.transform = `translate(${String(x)}px, ${String(y)}px) translate(-50%, -100%)`;
    }
  };
  const placeAll = () => {
    for (const badge of badges.values()) place(badge);
  };

  /** Matches the badges to the view's tiles with gatherers. */
  const draw = (view: MapView) => {
    const wanted = new Map(
      view.tiles.filter((t) => (t.workers ?? 0) > 0).map((t) => [hexKey(t), t] as const),
    );
    for (const [key, badge] of badges) {
      if (!wanted.has(key)) {
        badge.node.remove();
        badges.delete(key);
      }
    }
    for (const [key, tile] of wanted) {
      const label = labelOf(tile.workers ?? 0);
      const badge = badges.get(key);
      if (badge) {
        badge.tile = tile;
        if (badge.label !== label) badge.node.textContent = label;
        badge.label = label;
        continue;
      }
      const node = el(
        'div',
        { class: 'gatherer-badge', 'aria-hidden': 'true', 'data-testid': 'gatherer-badge' },
        label,
      );
      node.hidden = true;
      root.append(node);
      const added = { tile, node, at: '', label };
      badges.set(key, added);
      place(added);
    }
  };

  const clear = () => {
    for (const badge of badges.values()) badge.node.remove();
    badges.clear();
  };

  return {
    attach: (next, view) => {
      clear();
      scene = next;
      draw(view);
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        clear();
      });
    },
    update: (view) => {
      if (scene) draw(view);
    },
    get shown() {
      return [...badges.values()].filter((b) => !b.node.hidden).length;
    },
  };
}
