import type { Scene } from '@babylonjs/core/scene';
import { hexKey, type CommunityView, type MapView, type PublicTile } from '@heartpatch/shared';
import { findHomeBases } from '../map/map-layout.js';
import { tileScreenRectOf } from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { FLAG_GAP_PX, placeFlags } from '../trading/flag-spot.js';
import { flagRoom } from '../trading/post-flags.js';
import '../trading/trading.css';
import { boxOf } from '../tutorial/sheets.js';
import { el } from '../ui/dom.js';
import type { Rect } from '../ui/geometry.js';
import { communityFlagLabel } from './community-model.js';
import './hollowed.css';

// A flag over every Hollowed village (#306): "🕯️ Bramble Hollow · 1/5
// restored" when my land touches it, "· 3 tiles away" when it doesn't. They
// join the trading posts' flag room (`flagRoom`, post-flags.ts): clear of the
// top bar, the patch name, the tray handles, the night's chips, open sheets
// and my Keeper, and of every other flag on screen (posts', homes') and each
// other. A crowded flag moves to the nearest free spot (`placeFlags`) rather
// than overlap. A DOM overlay, placed after the post flags each drawn frame
// (this layer attaches after theirs), touching the DOM only when one moved.
// The village's lavender outline is drawn with the land borders (map-scene).

export interface CommunityFlags extends MapLayer {
  /** Flags on screen now (the dev hook): their words and boxes in CSS pixels. */
  readonly shown: readonly { label: string; box: Rect }[];
}

interface Flag {
  community: CommunityView;
  /** The village's tiles: the flag stands over them all, so it never hides the village. */
  tiles: PublicTile[];
  node: HTMLElement;
  label: string;
  /** Where it last showed ('hidden' when it didn't), so an unchanged flag writes nothing. */
  at: string;
  /** Its size when last shown; null until then or after its words change. */
  size: { width: number; height: number } | null;
  box: Rect | null;
}

/** A flag's size before it has been laid out. */
const FLAG_MIN = { width: 120, height: 26 };
/** Every other map flag (posts', homes'), which village flags keep clear of. */
const OTHER_FLAGS = '.post-flag:not(.community-flag)';

export function createCommunityFlags(root: HTMLElement, me: () => string | null): CommunityFlags {
  let scene: Scene | null = null;
  const flags = new Map<string, Flag>();
  /** My Heart Seed's tile, where my Keeper stands; null with no land here. */
  let seed: PublicTile | null = null;

  const measure = (target: Scene) => {
    const room = flagRoom(seed ? tileScreenRectOf(target, seed) : null);
    const covers = [...room.covers];
    for (const node of document.querySelectorAll(OTHER_FLAGS)) {
      const box = boxOf(node)?.box;
      if (!box) continue;
      covers.push({
        x: box.x - FLAG_GAP_PX,
        y: box.y - FLAG_GAP_PX,
        width: box.width + FLAG_GAP_PX * 2,
        height: box.height + FLAG_GAP_PX * 2,
      });
    }
    return { ...room, covers };
  };

  const placeAll = (again = true): void => {
    if (!scene || flags.size === 0) return;
    const target = scene;
    const list = [...flags.values()];
    for (const f of list) {
      if (f.node.offsetWidth > 0) {
        f.size = { width: f.node.offsetWidth, height: f.node.offsetHeight };
      }
    }
    const spots = placeFlags(
      list.map((f) => ({ tile: villageRect(target, f.tiles), size: f.size ?? FLAG_MIN })),
      measure(target),
    );
    let fresh = false;
    for (const [i, f] of list.entries()) {
      const spot = spots[i] ?? null;
      const size = f.size ?? FLAG_MIN;
      f.box = spot
        ? {
            x: spot.x - size.width / 2,
            y: spot.y - size.height,
            width: size.width,
            height: size.height,
          }
        : null;
      const at = spot ? `${String(spot.x)},${String(spot.y)}` : 'hidden';
      if (at === f.at) continue;
      f.at = at;
      // Shown for the first time, it was placed by the stand-in size: place
      // everything again by its own (an idle map draws no frame to fix it).
      if (spot && f.node.hidden && f.size === null) fresh = true;
      f.node.hidden = spot === null;
      if (spot) {
        f.node.style.transform = `translate(${String(spot.x)}px, ${String(spot.y)}px) translate(-50%, -100%)`;
      }
    }
    if (fresh && again) placeAll(false);
  };

  // A sheet, a chip or a post flag showing or hiding over an idle map draws
  // no frame, so look again on the next one, as the post flags do. My own
  // flags' changes are skipped.
  let recheck = 0;
  const watch = new MutationObserver((changes) => {
    if (recheck || !scene) return;
    if (
      changes.every(
        (c) => c.target instanceof HTMLElement && c.target.classList.contains('community-flag'),
      )
    ) {
      return;
    }
    recheck = requestAnimationFrame(() => {
      recheck = 0;
      placeAll();
    });
  });

  const draw = (view: MapView): void => {
    const mine = me();
    seed =
      mine === null
        ? null
        : (findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === mine)?.seed ?? null);
    const byKey = new Map(view.tiles.map((t) => [hexKey(t), t] as const));
    // Won villages are someone's home now: no Hollowed flag.
    const wanted = new Map(
      (view.communities ?? []).filter((c) => c.ownerUserId === null).map((c) => [c.id, c] as const),
    );
    for (const [id, flag] of flags) {
      if (!wanted.has(id)) {
        flag.node.remove();
        flags.delete(id);
      }
    }
    let changed = false;
    for (const [id, community] of wanted) {
      const tiles = community.tiles.flatMap((h) => byKey.get(hexKey(h)) ?? []);
      if (tiles.length === 0) continue;
      const label = communityFlagLabel(community);
      const touching = community.reach === 'touching';
      const flag = flags.get(id);
      if (flag) {
        flag.community = community;
        flag.tiles = tiles;
        flag.node.classList.toggle('community-flag-touching', touching);
        if (flag.label !== label) {
          flag.label = label;
          flag.node.textContent = label;
          flag.size = null;
          changed = true;
        }
        continue;
      }
      const node = el(
        'div',
        {
          class: `post-flag community-flag${touching ? ' community-flag-touching' : ''}`,
          'aria-hidden': 'true',
          'data-testid': 'community-flag',
        },
        label,
      );
      node.hidden = true;
      root.append(node);
      flags.set(id, { community, tiles, node, label, at: '', size: null, box: null });
      changed = true;
    }
    if (changed) placeAll();
  };

  const clear = (): void => {
    for (const flag of flags.values()) flag.node.remove();
    flags.clear();
    seed = null;
  };

  return {
    attach: (next, view) => {
      clear();
      scene = next;
      draw(view);
      const placed = next.onAfterRenderObservable.add(() => {
        placeAll();
      });
      watch.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'inert', 'class'],
      });
      next.onDisposeObservable.addOnce(() => {
        next.onAfterRenderObservable.remove(placed);
        if (scene !== next) return;
        scene = null;
        watch.disconnect();
        clear();
      });
    },
    update: (view) => {
      if (scene) draw(view);
    },
    get shown() {
      return [...flags.values()].flatMap((f) =>
        f.box && !f.node.hidden ? [{ label: f.label, box: f.box }] : [],
      );
    },
  };
}

/** The screen box around every on-screen tile of a village; null when none is on screen. */
function villageRect(target: Scene, tiles: readonly PublicTile[]): Rect | null {
  let box: Rect | null = null;
  for (const t of tiles) {
    const r = tileScreenRectOf(target, t);
    if (r === null) continue;
    if (box === null) {
      box = r;
      continue;
    }
    const x = Math.min(box.x, r.x);
    const y = Math.min(box.y, r.y);
    box = {
      x,
      y,
      width: Math.max(box.x + box.width, r.x + r.width) - x,
      height: Math.max(box.y + box.height, r.y + r.height) - y,
    };
  }
  return box;
}
