import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, type HexKey, type PublicTile } from '@heartpatch/shared';
import type { MapLayer } from './map-screen.js';
import { flagRoom } from '../trading/post-flags.js';
import { boxOf } from '../tutorial/sheets.js';
import { el } from '../ui/dom.js';
import { intersects, type Rect } from '../ui/geometry.js';
import { TILE_MARK } from './map-config.js';
import { tileScreenRectOf, type ScreenRect } from './map-scene.js';

// One small, quiet mark on a tile of mine that needs me (#602, owner decision
// 2026-10-22: a quiet map, details on tap). Only ever my own problems: a
// gatherer of mine that isn't keen, or one napping. Features hand in their
// marks by source (`set('gatherers', …)`) on the one layer main.ts makes;
// #601's resource buildings add theirs (full, paused for upkeep) the same
// way, with their kinds in `TILE_MARK`. A tile shows one mark, the most
// pressing of what its sources say.
//
// A DOM overlay. A mark with an anchor (a gatherer's head) sits just beside
// it, so it says which squishy; one without sits in the tile's top corner,
// placed with the map's one tile projection. It keeps to the flags' room
// (`flagRoom`, post-flags.ts): clear of the top bar, the patch name, the
// tray handles, the night's chips, open sheets and every map flag, trying
// the other side of the head, then above it, and hiding only when all three
// are covered. Unlike the old 🧺 badges it never pins to the screen's edge
// and never steps clear of a neighbour: a mark whose spot is off screen
// shows nothing.

/** What a mark says (`TILE_MARK.kinds`, most pressing first). */
export type TileMarkKind = (typeof TILE_MARK.kinds)[number];

export interface TileMark {
  readonly tile: PublicTile;
  readonly kind: TileMarkKind;
  /** What it's about, in the world (a gatherer's head): the mark sits beside it. Else the tile's corner. */
  readonly at?: { readonly x: number; readonly y: number; readonly z: number };
}

/** A map layer: pass it to the map screen once, and to every feature that marks tiles. */
export interface TileMarks extends MapLayer {
  /** Replaces one source's marks (e.g. `gatherers`); an empty list drops them. */
  set: (source: string, marks: readonly TileMark[]) => void;
  /** Drops every source's marks (another player signed in). */
  clear: () => void;
  /** Marks on screen now, by kind (the dev hook). */
  readonly shown: Readonly<Partial<Record<TileMarkKind, number>>>;
}

interface Shown {
  tile: PublicTile;
  kind: TileMarkKind;
  anchor: TileMark['at'];
  node: HTMLElement;
  /** Where it last sat, so an unmoved mark writes nothing. */
  at: string;
}

const RANK = new Map<TileMarkKind, number>(TILE_MARK.kinds.map((k, i) => [k, i]));

/**
 * Each tile's one mark: the most pressing of what every source says there
 * (pure, for tests).
 */
export function pickMarks(
  sources: ReadonlyMap<string, readonly TileMark[]>,
): Map<HexKey, TileMark> {
  const picked = new Map<HexKey, TileMark>();
  for (const marks of sources.values()) {
    for (const mark of marks) {
      const key = hexKey(mark.tile);
      const had = picked.get(key);
      if (!had || (RANK.get(mark.kind) ?? 0) < (RANK.get(had.kind) ?? 0)) picked.set(key, mark);
    }
  }
  return picked;
}

/**
 * Where a mark sits (CSS px, its middle), or null to hide it: beside its
 * anchor's screen point when it has one (the first of `TILE_MARK.beside`
 * clear of `covers`), else in its tile's top right, inside the rim. Hidden
 * off screen, or when every spot touches a cover (pure, for tests).
 */
export function markSpot(
  anchor: { x: number; y: number } | null,
  rect: ScreenRect | null,
  screen: { width: number; height: number },
  covers: readonly Rect[] = [],
): { x: number; y: number } | null {
  const tries = anchor
    ? TILE_MARK.beside.map((d) => ({ x: anchor.x + d.x, y: anchor.y + d.y }))
    : rect
      ? [{ x: rect.x + rect.width * TILE_MARK.across, y: rect.y + rect.height * TILE_MARK.down }]
      : [];
  const half = TILE_MARK.size / 2;
  for (const at of tries) {
    if (at.x < 0 || at.y < 0 || at.x > screen.width || at.y > screen.height) return null;
    const box = { x: at.x - half, y: at.y - half, width: TILE_MARK.size, height: TILE_MARK.size };
    if (covers.some((cover) => intersects(box, cover))) continue;
    return { x: Math.round(at.x), y: Math.round(at.y) };
  }
  return null;
}

/** Map flags (trading posts, homes, Hollows), which marks keep clear of. */
const FLAGS = '.post-flag';

/** What a mark must not touch: the flags' room (no Keeper cover) and every map flag shown. */
function markCovers(): Rect[] {
  const covers = [...flagRoom(null).covers];
  for (const node of document.querySelectorAll(FLAGS)) {
    const box = boxOf(node)?.box;
    if (box) covers.push(box);
  }
  return covers;
}

/** Scratch for `screenPointOf`, which runs every drawn frame while a mark shows. */
const WORLD = new Vector3();
const PROJECTED = new Vector3();

/**
 * A world point on screen (CSS px), or null when the camera can't see it.
 * Projects with the camera as it is now, as `tileScreenRectOf` does.
 */
function screenPointOf(
  scene: Scene,
  box: DOMRect,
  at: { x: number; y: number; z: number },
): { x: number; y: number } | null {
  const camera = scene.activeCamera;
  if (!camera || box.width <= 0 || box.height <= 0) return null;
  const viewport = camera.viewport.toGlobal(box.width, box.height);
  WORLD.set(at.x, at.y, at.z);
  const s = Vector3.ProjectToRef(
    WORLD,
    Matrix.IdentityReadOnly,
    camera.getTransformationMatrix(),
    viewport,
    PROJECTED,
  );
  if (s.z < 0 || s.z > 1) return null; // behind the camera or past the far plane
  return { x: box.left + s.x, y: box.top + s.y };
}

export function createTileMarks(root: HTMLElement): TileMarks {
  let scene: Scene | null = null;
  const sources = new Map<string, readonly TileMark[]>();
  const shown = new Map<HexKey, Shown>();

  /**
   * `box`: the canvas on screen and `covers` what to keep clear of, both
   * read once a frame (before any mark moves).
   */
  const place = (mark: Shown, box: DOMRect | null, covers: readonly Rect[]) => {
    const spot = markSpot(
      scene && box && mark.anchor ? screenPointOf(scene, box, mark.anchor) : null,
      scene && !mark.anchor ? tileScreenRectOf(scene, mark.tile) : null,
      { width: window.innerWidth, height: window.innerHeight },
      covers,
    );
    const at = spot ? `${String(spot.x)},${String(spot.y)}` : 'hidden';
    if (at === mark.at) return;
    mark.at = at;
    mark.node.hidden = spot === null;
    if (spot) {
      mark.node.style.transform = `translate(${String(spot.x)}px, ${String(spot.y)}px) translate(-50%, -50%)`;
    }
  };
  const canvasBox = () => scene?.getEngine().getRenderingCanvas()?.getBoundingClientRect() ?? null;
  const placeAll = () => {
    if (shown.size === 0) return;
    const box = canvasBox();
    const covers = markCovers();
    for (const mark of shown.values()) place(mark, box, covers);
  };

  // A sheet opening or shutting over an idle map draws no frame, so watch for
  // it and place the marks again on the next frame, as the flags do
  // (post-flags.ts): a mark hidden under the job board shows once it shuts.
  // A mark's own changes are skipped.
  let recheck = 0;
  const watch = new MutationObserver((changes) => {
    if (recheck || !scene || shown.size === 0) return;
    if (
      changes.every(
        (c) => c.target instanceof HTMLElement && c.target.classList.contains('tile-mark'),
      )
    ) {
      return;
    }
    recheck = requestAnimationFrame(() => {
      recheck = 0;
      if (scene) placeAll();
    });
  });

  /** Matches the marks on screen to what the sources say now. */
  const draw = () => {
    const wanted = pickMarks(sources);
    for (const [key, mark] of shown) {
      if (wanted.get(key)?.kind === mark.kind) continue;
      mark.node.remove();
      shown.delete(key);
    }
    for (const [key, want] of wanted) {
      const had = shown.get(key);
      if (had) {
        had.tile = want.tile;
        had.anchor = want.at;
        had.at = '';
        place(had, canvasBox(), markCovers());
        continue;
      }
      const node = el(
        'div',
        {
          class: `tile-mark tile-mark-${want.kind}`,
          'aria-hidden': 'true',
          'data-testid': 'tile-mark',
          'data-kind': want.kind,
        },
        TILE_MARK.glyphs[want.kind],
      );
      node.hidden = true;
      root.append(node);
      const added: Shown = { tile: want.tile, kind: want.kind, anchor: want.at, node, at: '' };
      shown.set(key, added);
      place(added, canvasBox(), markCovers());
    }
  };

  return {
    attach: (next) => {
      scene = next;
      placeAll();
      next.onAfterRenderObservable.add(placeAll);
      watch.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'inert', 'class'],
      });
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        watch.disconnect();
        cancelAnimationFrame(recheck);
        recheck = 0;
        placeAll();
      });
    },
    set: (source, marks) => {
      sources.set(source, marks);
      draw();
    },
    clear: () => {
      sources.clear();
      draw();
    },
    get shown() {
      const counts: Partial<Record<TileMarkKind, number>> = {};
      for (const mark of shown.values()) {
        if (!mark.node.hidden) counts[mark.kind] = (counts[mark.kind] ?? 0) + 1;
      }
      return counts;
    },
  };
}
