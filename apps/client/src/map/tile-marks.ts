import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, type HexKey, type PublicTile } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { TILE_MARK } from './map-config.js';
import { tileScreenRectOf, type ScreenRect } from './map-scene.js';

// One small, quiet mark on a tile of mine that needs me (#602, owner decision
// 2026-10-22: a quiet map, details on tap). Only ever my own problems: a
// gatherer of mine that isn't keen, or one napping. Features hand in their
// marks by source (`set('gatherers', …)`); #601's resource buildings add
// theirs (full, paused for upkeep) the same way. A tile shows one mark, the
// most pressing of what its sources say.
//
// A DOM overlay. A mark with an anchor (a gatherer's head) sits just beside
// it, so it says which squishy; one without sits in the tile's top corner,
// placed with the map's one tile projection. Unlike the old 🧺 badges it
// never pins to the screen's edge and never steps clear of a neighbour: a
// mark whose spot is off screen shows nothing.

/** What a mark says, most pressing first (the order `TILE_MARK.kinds` lists them in). */
export type TileMarkKind = keyof typeof TILE_MARK.kinds;

export interface TileMark {
  readonly tile: PublicTile;
  readonly kind: TileMarkKind;
  /** What it's about, in the world (a gatherer's head): the mark sits beside it. Else the tile's corner. */
  readonly at?: { readonly x: number; readonly y: number; readonly z: number };
}

export interface TileMarks {
  /** The map was built into a fresh scene: marks follow its camera. */
  attach: (scene: Scene) => void;
  /** Replaces one source's marks (e.g. `gatherers`). */
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

const RANK = new Map(Object.keys(TILE_MARK.kinds).map((k, i) => [k as TileMarkKind, i]));

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
 * Where a mark sits (CSS px, its middle), or null when that's off screen:
 * beside its anchor's screen point when it has one, else in its tile's top
 * right, inside the rim (pure, for tests).
 */
export function markSpot(
  anchor: { x: number; y: number } | null,
  rect: ScreenRect | null,
  screen: { width: number; height: number },
): { x: number; y: number } | null {
  let x: number;
  let y: number;
  if (anchor) {
    x = anchor.x + TILE_MARK.beside.x;
    y = anchor.y + TILE_MARK.beside.y;
  } else if (rect) {
    x = rect.x + rect.width * TILE_MARK.across;
    y = rect.y + rect.height * TILE_MARK.down;
  } else return null;
  if (x < 0 || y < 0 || x > screen.width || y > screen.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
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
  at: { x: number; y: number; z: number },
): { x: number; y: number } | null {
  const camera = scene.activeCamera;
  const canvas = scene.getEngine().getRenderingCanvas();
  if (!camera || !canvas) return null;
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
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

  const place = (mark: Shown) => {
    const spot = markSpot(
      scene && mark.anchor ? screenPointOf(scene, mark.anchor) : null,
      scene && !mark.anchor ? tileScreenRectOf(scene, mark.tile) : null,
      { width: window.innerWidth, height: window.innerHeight },
    );
    const at = spot ? `${String(spot.x)},${String(spot.y)}` : 'hidden';
    if (at === mark.at) return;
    mark.at = at;
    mark.node.hidden = spot === null;
    if (spot) {
      mark.node.style.transform = `translate(${String(spot.x)}px, ${String(spot.y)}px) translate(-50%, -50%)`;
    }
  };
  const placeAll = () => {
    for (const mark of shown.values()) place(mark);
  };

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
        place(had);
        continue;
      }
      const kind = TILE_MARK.kinds[want.kind];
      const node = el(
        'div',
        {
          class: `tile-mark tile-mark-${want.kind}`,
          'aria-hidden': 'true',
          'data-testid': 'tile-mark',
          'data-kind': want.kind,
        },
        kind.glyph,
      );
      node.hidden = true;
      root.append(node);
      const added: Shown = { tile: want.tile, kind: want.kind, anchor: want.at, node, at: '' };
      shown.set(key, added);
      place(added);
    }
  };

  return {
    attach: (next) => {
      scene = next;
      placeAll();
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
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
