import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  type HexKey,
  type JobsView,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { tileScreenRectOf } from '../../map/map-scene.js';
import type { MapLayer } from '../../map/map-screen.js';
import { el } from '../../ui/dom.js';
import { badgeLabel, tileMoods, type WorkMood } from './jobs-view.js';

// A little 🧺 over every tile where a squishy is gathering (squishy jobs), as
// a DOM overlay placed with the map's one tile projection (`tileScreenRectOf`),
// so the 3D scene stays the terrain lane's. Drawn from the map's own view
// (`PublicTile.workers`, which `MapState` keeps live and a resync refetches),
// so it never keeps a second count. Badges move only when a frame is drawn
// (frames are drawn on demand) and touch the DOM only when they moved.
//
// Over my own gatherers the badge also says how they feel (#393): 💕 at a
// spot they love, 🌧️ where they aren't keen. Fit is personal, so it comes
// from my own jobs view (`setMine`), never the public map view every member
// sees: a patch-mate's badge stays a plain 🧺.

export interface GathererBadgesOptions {
  /**
   * Asks for my jobs view of this map (it arrives through `setMine`): when
   * the layer attaches, and when the map's gatherer counts change.
   */
  load?: (mapId: string) => void;
}

export interface GathererBadges extends MapLayer {
  /** My jobs view of a map: my gatherers' badges say how they feel (#393). */
  setMine: (mapId: string, view: Pick<JobsView, 'squishies'>) => void;
  /** Drops my moods (another player signed in): every badge is a plain 🧺 again. */
  forget: () => void;
  /** Badges on screen now (the dev hook). */
  readonly shown: number;
  /** Badges on screen now showing a mood, by mood (the dev hook). */
  readonly moods: Readonly<Record<WorkMood, number>>;
}

interface Badge {
  tile: PublicTile;
  node: HTMLElement;
  /** Where and what it last showed, so an unchanged badge writes nothing. */
  at: string;
  label: string;
  mood: WorkMood | null;
  /** Where it sits this frame (CSS px, its bottom middle), before stepping clear of others. */
  x: number;
  y: number;
  shown: boolean;
}

/** Space kept between two badges, CSS px. */
const BADGE_SPACING = 4;

/** A badge's size before it has been laid out. */
const BADGE_MIN_WIDTH_PX = 32;
const BADGE_MIN_HEIGHT_PX = 24;

export function createGathererBadges(
  root: HTMLElement,
  options: GathererBadgesOptions = {},
): GathererBadges {
  let scene: Scene | null = null;
  let view: MapView | null = null;
  /** My gatherers' mood per tile, and the map it came from. */
  let mine: { mapId: string; moods: Map<HexKey, WorkMood> } | null = null;
  /** The gatherer counts last asked about, so an unchanged view doesn't ask again. */
  let asked = '';
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
    // Hung from the tile's top: a tile straddling the top edge keeps it in view too.
    const y = rect
      ? Math.round(Math.max(rect.y, Math.max(badge.node.offsetHeight, BADGE_MIN_HEIGHT_PX)))
      : 0;
    badge.x = x;
    badge.y = y;
    badge.shown = rect !== null;
  };
  /** Writes a badge's spot to the DOM, only when it changed. */
  const show = (badge: Badge) => {
    const at = badge.shown ? `${String(badge.x)},${String(badge.y)}` : 'hidden';
    if (at === badge.at) return;
    badge.at = at;
    badge.node.hidden = !badge.shown;
    if (badge.shown) {
      badge.node.style.transform = `translate(${String(badge.x)}px, ${String(badge.y)}px) translate(-50%, -100%)`;
    }
  };
  const placeAll = () => {
    for (const badge of badges.values()) place(badge);
    // Badges on neighbouring tiles never touch (#393's bigger mood badges):
    // a later one steps up above any earlier one it would meet.
    let i = 0;
    for (const badge of badges.values()) {
      if (badge.shown) {
        const w = Math.max(badge.node.offsetWidth, BADGE_MIN_WIDTH_PX);
        const h = Math.max(badge.node.offsetHeight, BADGE_MIN_HEIGHT_PX);
        let j = 0;
        for (const other of badges.values()) {
          if (j++ >= i) break;
          if (!other.shown) continue;
          const ow = Math.max(other.node.offsetWidth, BADGE_MIN_WIDTH_PX);
          const apart = Math.abs(badge.x - other.x) >= (w + ow) / 2 + BADGE_SPACING;
          if (!apart && Math.abs(badge.y - other.y) < h + BADGE_SPACING) {
            badge.y = other.y - h - BADGE_SPACING;
          }
        }
      }
      i += 1;
    }
    for (const badge of badges.values()) show(badge);
  };

  /** Asks for my moods again when the map's gatherers changed. */
  const ask = (next: MapView, wanted: ReadonlyMap<HexKey, PublicTile>) => {
    if (!options.load) return;
    const counts = [...wanted].map(([key, t]) => `${key}:${String(t.workers ?? 0)}`).join(' ');
    const at = `${next.map.id} ${counts}`;
    if (at === asked) return;
    asked = at;
    if (counts !== '') options.load(next.map.id);
  };

  /** Matches the badges to the view's tiles with gatherers. */
  const draw = (next: MapView) => {
    view = next;
    const wanted = new Map(
      next.tiles.filter((t) => (t.workers ?? 0) > 0).map((t) => [hexKey(t), t] as const),
    );
    ask(next, wanted);
    const moods = mine?.mapId === next.map.id ? mine.moods : null;
    for (const [key, badge] of badges) {
      if (!wanted.has(key)) {
        badge.node.remove();
        badges.delete(key);
      }
    }
    for (const [key, tile] of wanted) {
      const mood = moods?.get(key) ?? null;
      const label = badgeLabel(tile.workers ?? 0, mood);
      const badge = badges.get(key);
      if (badge) {
        badge.tile = tile;
        if (badge.label !== label) badge.node.textContent = label;
        if (badge.mood !== mood) moodClass(badge.node, mood);
        badge.label = label;
        badge.mood = mood;
        continue;
      }
      const node = el(
        'div',
        { class: 'gatherer-badge', 'aria-hidden': 'true', 'data-testid': 'gatherer-badge' },
        label,
      );
      node.hidden = true;
      moodClass(node, mood);
      root.append(node);
      const added = { tile, node, at: '', label, mood, x: 0, y: 0, shown: false };
      badges.set(key, added);
      place(added);
      show(added);
    }
  };

  const clear = () => {
    for (const badge of badges.values()) badge.node.remove();
    badges.clear();
    view = null;
    asked = '';
  };

  return {
    attach: (next, first) => {
      clear();
      scene = next;
      draw(first);
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        clear();
      });
    },
    update: (next) => {
      if (scene) draw(next);
    },
    setMine: (mapId, jobs) => {
      mine = { mapId, moods: tileMoods(jobs) };
      if (scene && view?.map.id === mapId) draw(view);
    },
    forget: () => {
      mine = null;
      asked = '';
      if (scene && view) draw(view);
    },
    get shown() {
      return [...badges.values()].filter((b) => !b.node.hidden).length;
    },
    get moods() {
      const shown = { loves: 0, meh: 0 };
      for (const b of badges.values()) if (!b.node.hidden && b.mood) shown[b.mood] += 1;
      return shown;
    },
  };
}

/** The badge's tint for my gatherers' mood (#393). */
function moodClass(node: HTMLElement, mood: WorkMood | null): void {
  node.classList.toggle('gatherer-badge-loves', mood === 'loves');
  node.classList.toggle('gatherer-badge-meh', mood === 'meh');
}
