import {
  edgeNeighbor,
  HEX_EDGES,
  hexKey,
  hexToWorld,
  type Hex,
  type HexEdge,
  type HexKey,
} from '@heartpatch/shared';
import { roundedHexOutline, type MeshArrays, type ProfileRing } from './hex-mesh.js';
import { BORDER, type BorderLine, type KeeperIcon } from './map-config.js';

// Land borders (#278): one mesh per Keeper, so whose land is whose reads at a
// glance. A light wash over every tile they hold (no rim per tile, so their
// land reads as one shape), a soft ribbon along only its outer edges, and
// their icon on every few border tiles. Edge `e` of a tile faces
// `edgeNeighbor(tile, e)`, as fences do (#203). An edge is outer when the
// tile across it isn't theirs: a rival's, neutral land, a trading post, or
// nothing at all past the map's rim. Pure, so the shapes are unit-tested.

/** A tile of one Keeper's land: where it is and the height of its top. */
export interface BorderTile extends Hex {
  readonly top: number;
  /** Home tiles never carry an icon badge (the Heart Seed is there). */
  readonly home: boolean;
}

/** The tile's shape, as the map draws it. */
export interface BorderShape {
  /** Hex size (`hexToWorld`) and the drawn radius of a tile. */
  readonly size: number;
  readonly radius: number;
  /** Corner radius as a fraction of `radius`, and segments per rounded corner (the tile's own). */
  readonly corner: number;
  readonly segments: number;
  /** The rounded top's height at its middle, and its rings outward (the tile's own profile). */
  readonly dome: number;
  readonly rings: readonly ProfileRing[];
}

/** How one Keeper's border looks. */
export interface BorderLook {
  /** Linear RGB, 0–1. */
  readonly rgb: readonly [number, number, number];
  readonly line: BorderLine;
  readonly icon: KeeperIcon;
}

/** The wash's corners: it's faint, so fewer points than the tile's do. */
const WASH_SEGMENTS = 2;
/** Points round an icon and its white badge. */
const ICON_POINTS = 32;
const BADGE_POINTS = 20;
const WHITE = [1, 1, 1] as const;

/** Edges of `tile` that face land `owned` doesn't include (the map's rim included). */
export function outerEdges(tile: Hex, owned: ReadonlySet<HexKey>): HexEdge[] {
  return HEX_EDGES.filter((edge) => !owned.has(hexKey(edgeNeighbor(tile, edge))));
}

/**
 * The pieces of one edge's ribbon for a line style, along the edge (0–1)
 * and across it (shares of the radius). Each style repeats per edge, so the
 * pattern runs on unbroken from tile to tile.
 */
export function linePieces(
  line: BorderLine,
): { from: number; to: number; fade: number; inner: number; outer: number }[] {
  const { fade, inner, outer } = BORDER.ribbon;
  switch (line) {
    case 'solid':
      return [{ from: 0, to: 1, fade, inner, outer }];
    case 'dash':
      return [0, 1, 2].map((k) => ({ from: k / 3 + 0.04, to: k / 3 + 0.26, fade, inner, outer }));
    case 'dot':
      return [0, 1, 2, 3, 4].map((k) => ({
        from: k / 5 + 0.05,
        to: k / 5 + 0.14,
        fade: inner - 0.02,
        inner,
        outer,
      }));
    case 'double': {
      const mid = (inner + outer) / 2;
      return [
        { from: 0, to: 1, fade: mid + 0.02, inner: mid + 0.03, outer },
        { from: 0, to: 1, fade: inner - 0.02, inner, outer: mid - 0.03 },
      ];
    }
  }
}

/** An icon's outline round its middle, about 1 across (+z is up the screen). */
export function iconOutline(icon: KeeperIcon, points = ICON_POINTS): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    if (icon === 'heart') {
      // The classic heart curve, centred and scaled to about 1 across.
      const x = 16 * Math.sin(t) ** 3;
      const z = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push({ x: x / 17, z: (z + 2) / 17 });
      continue;
    }
    const r =
      icon === 'star'
        ? 0.42 + 0.55 * (0.5 + 0.5 * Math.cos(5 * t)) ** 2.2
        : icon === 'flower'
          ? 0.62 + 0.36 * Math.abs(Math.cos(2.5 * t))
          : 1 / (Math.abs(Math.sin(t)) / 0.75 + Math.abs(Math.cos(t)));
    out.push({ x: Math.sin(t) * r, z: Math.cos(t) * r });
  }
  return out;
}

/** `list[i]`, which the loops here always keep in range. */
function item<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new RangeError(`border-layout: no item ${String(i)}`);
  return value;
}

/**
 * The wash's rings: the tile's own from 0.8 out to just inside its rim, so
 * no pale rim shows round each tile. Inside 0.8 it steps straight from the
 * middle, under the tile's dome (its 0.5 ring) by most of `BORDER.lift.wash`:
 * it clears a lake's bob by under 0.001, so raise the lift before lowering it
 * (border-layout.test.ts checks it).
 */
function washRings(shape: BorderShape): number[] {
  return shape.rings.map((r) => r.scale).filter((s) => s > 0.5 && s < 1);
}

/** Height of the tile's top at `scale` of its radius, from its dome and rings (linear between). */
export function profileAt(shape: BorderShape, scale: number): number {
  let s0 = 0;
  let y0 = shape.dome;
  for (const ring of shape.rings) {
    if (scale <= ring.scale) return y0 + ((ring.y - y0) * (scale - s0)) / (ring.scale - s0 || 1);
    s0 = ring.scale;
    y0 = ring.y;
  }
  return y0;
}

class Arrays {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, rgb: readonly number[], alpha: number): number {
    this.positions.push(x, y, z);
    this.colors.push(rgb[0] ?? 1, rgb[1] ?? 1, rgb[2] ?? 1, alpha);
    return this.positions.length / 3 - 1;
  }

  /** A triangle facing up, wound as `loftRoundedHex` winds its top (outline order). */
  up(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }
}

/**
 * One Keeper's border: the wash over all of `tiles`, the ribbon along their
 * outer edges, and an icon badge on every `BORDER.iconEvery`-th border tile.
 * Wash first, then ribbon, then badges, so each draws over the one before
 * in the same draw call. Empty arrays for no land.
 */
export function borderArrays(
  tiles: readonly BorderTile[],
  shape: BorderShape,
  look: BorderLook,
): MeshArrays {
  const out = new Arrays();
  const owned = new Set(tiles.map(hexKey));
  // Same order on every device, whatever order the view listed them in.
  const sorted = [...tiles].sort((a, b) => a.q - b.q || a.r - b.r);
  const wash = roundedHexOutline(shape.radius, shape.radius * shape.corner, WASH_SEGMENTS);
  // The tile's own outline, so the ribbon lies on its top all the way round.
  const outline = roundedHexOutline(shape.radius, shape.radius * shape.corner, shape.segments);

  for (const tile of sorted) {
    const c = hexToWorld(tile, shape.size);
    const y = tile.top + BORDER.lift.wash;
    const centre = out.vertex(c.x, y + shape.dome, c.z, look.rgb, BORDER.wash);
    // The tile's own rings, so the wash stays clear of its top everywhere
    // (a lake's waves bob under it, `AMBIENT.water.bob`).
    const rings = washRings(shape).map((scale) =>
      wash.map((p) =>
        out.vertex(
          c.x + p.x * scale,
          y + profileAt(shape, scale),
          c.z + p.z * scale,
          look.rgb,
          BORDER.wash,
        ),
      ),
    );
    const n = wash.length;
    rings.forEach((ring, j) => {
      const inside = rings[j - 1];
      for (let i = 0; i < n; i++) {
        const k = (i + 1) % n;
        if (!inside) {
          out.up(centre, item(ring, i), item(ring, k));
          continue;
        }
        out.up(item(inside, i), item(ring, k), item(inside, k));
        out.up(item(inside, i), item(ring, i), item(ring, k));
      }
    });
  }

  for (const tile of sorted) {
    for (const edge of outerEdges(tile, owned)) ribbon(out, tile, edge, outline, shape, look);
  }

  let border = 0;
  for (const tile of sorted) {
    const edges = outerEdges(tile, owned);
    if (edges.length === 0 || tile.home) continue;
    if (border++ % BORDER.iconEvery !== 0) continue;
    badge(out, tile, item(edges, 0), shape, look);
  }

  return out.positions.length === 0
    ? { positions: [], indices: [], colors: [] }
    : { positions: out.positions, indices: out.indices, colors: out.colors };
}

/** The outline's points along `edge`: the second half of the corner before it, the first half of its own. */
function edgePoints(
  outline: readonly { x: number; z: number }[],
  edge: HexEdge,
  segments: number,
): { x: number; z: number }[] {
  const per = segments + 1;
  const half = segments / 2;
  /** The corner's tip: its middle point, or halfway along its middle segment. */
  const tip = (corner: number) => {
    const a = item(outline, corner * per + Math.floor(half));
    const b = item(outline, corner * per + Math.ceil(half));
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  };
  const before = (edge + 5) % 6;
  const points = [tip(before)];
  for (let s = Math.floor(half) + 1; s <= segments; s++)
    points.push(item(outline, before * per + s));
  for (let s = 0; s < Math.ceil(half); s++) points.push(item(outline, edge * per + s));
  points.push(tip(edge));
  return points;
}

function ribbon(
  out: Arrays,
  tile: BorderTile,
  edge: HexEdge,
  outline: readonly { x: number; z: number }[],
  shape: BorderShape,
  look: BorderLook,
): void {
  const c = hexToWorld(tile, shape.size);
  const points = edgePoints(outline, edge, shape.segments);
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const a = item(points, i - 1);
    const b = item(points, i);
    along.push(item(along, i - 1) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const length = item(along, along.length - 1);
  /** The point `t` (0–1) along the edge, at `scale` of the radius, on the tile's top. */
  const at = (t: number, scale: number) => {
    const d = t * length;
    let i = 1;
    while (i < along.length - 1 && item(along, i) < d) i++;
    const a = item(points, i - 1);
    const b = item(points, i);
    const k = (d - item(along, i - 1)) / (item(along, i) - item(along, i - 1) || 1);
    return {
      x: c.x + (a.x + (b.x - a.x) * k) * scale,
      y: tile.top + BORDER.lift.ribbon + profileAt(shape, Math.min(scale, 1)),
      z: c.z + (a.z + (b.z - a.z) * k) * scale,
    };
  };
  for (const piece of linePieces(look.line)) {
    // Across the ribbon: its own edges plus every ring of the tile's top in
    // between, so it follows the bevel and keeps its whole lift.
    const across = [
      ...new Set([
        piece.fade,
        piece.inner,
        piece.outer,
        ...shape.rings
          .map((r) => r.scale)
          // Not right beside an edge row: that would make sliver triangles.
          .filter((s) => s > piece.fade + 0.01 && s < piece.outer - 0.01),
      ]),
    ].sort((a, b) => a - b);
    const alphaAt = (scale: number) =>
      scale >= piece.inner
        ? BORDER.ribbon.alpha
        : (BORDER.ribbon.alpha * (scale - piece.fade)) / (piece.inner - piece.fade);
    // Along it: the piece's ends and every outline point between, so it
    // bends where the tile's corners do and never cuts across one.
    const bends = along.map((d) => d / length).filter((t) => t > piece.from && t < piece.to);
    let last: number[] | null = null;
    for (const t of [piece.from, ...bends, piece.to]) {
      const row = across.map((scale) => {
        const p = at(t, scale);
        return out.vertex(p.x, p.y, p.z, look.rgb, alphaAt(scale));
      });
      if (last) {
        // As `loftRoundedHex` joins two rings: rows run in outline order.
        for (let j = 0; j < row.length - 1; j++) {
          out.up(item(last, j), item(row, j + 1), item(row, j));
          out.up(item(last, j), item(last, j + 1), item(row, j + 1));
        }
      }
      last = row;
    }
  }
}

/** The Keeper's icon on a white badge, lying on the tile halfway toward `edge`. */
function badge(
  out: Arrays,
  tile: BorderTile,
  edge: HexEdge,
  shape: BorderShape,
  look: BorderLook,
): void {
  const c = hexToWorld(tile, shape.size);
  const toward = (Math.PI / 3) * edge;
  const reach = shape.radius * 0.42;
  const x = c.x + Math.cos(toward) * reach;
  const z = c.z + Math.sin(toward) * reach;
  const y = tile.top + BORDER.lift.icon + profileAt(shape, 0.42);
  const size = BORDER.iconSize;
  const disc = (points: { x: number; z: number }[], scale: number, rgb: readonly number[]) => {
    const middle = out.vertex(x, y, z, rgb, 1);
    const ring = points.map((p) => out.vertex(x + p.x * scale, y, z + p.z * scale, rgb, 1));
    for (let i = 0; i < ring.length; i++)
      out.up(middle, item(ring, i), item(ring, (i + 1) % ring.length));
  };
  const round = Array.from({ length: BADGE_POINTS }, (_, i) => {
    const t = (i / BADGE_POINTS) * Math.PI * 2;
    return { x: Math.cos(t), z: Math.sin(t) };
  });
  disc(round, size * 0.62, WHITE);
  // Icon outlines run clockwise from +z; reverse them so they face up too.
  disc(iconOutline(look.icon).reverse(), size * 0.5, look.rgb);
}
