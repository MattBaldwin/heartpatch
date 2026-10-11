import type { FloaterGlyph } from '@heartpatch/shared';
import type { MeshArrays } from './body-shape.js';
import { FLOATER, type LodSettings } from './config.js';
import { orientTriangles } from './part-shapes.js';

/**
 * Flat glyphs for floaters (a species' `visual.floater`): one builder per
 * `FloaterGlyph`, so a new glyph in the shared schema fails to typecheck
 * here until it has one. Each glyph is a chunky shape over a slightly bigger
 * copy of itself, its outline: two flat layers facing −z (the camera, once
 * the field turns it to face the view), centred on the origin and one unit
 * tall. The outline is darker through vertex colours, which multiply the
 * per-instance colour, so a glyph is still one mesh and one draw call.
 */

export interface FloaterArrays extends MeshArrays {
  /** RGBA per vertex: white on the glyph, `FLOATER.outlineShade` on its outline. */
  readonly colors: number[];
}

type Point = readonly [number, number];

/** A glyph's pieces, each drawn once at its own size and once grown by `grow` (the outline). */
interface Piece {
  readonly triangles: (grow: number, detail: number) => Point[];
}

/** An ellipse at `centre`, turned `turn` radians anticlockwise, as a fan of triangles. */
function ellipse(centre: Point, rx: number, ry: number, turn: number): Piece {
  return {
    triangles: (grow, detail) => {
      const n = Math.max(12, detail * 2);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const at = (i: number): Point => {
        const a = (2 * Math.PI * i) / n;
        const x = (rx + grow) * Math.cos(a);
        const y = (ry + grow) * Math.sin(a);
        return [centre[0] + x * cos - y * sin, centre[1] + x * sin + y * cos];
      };
      const out: Point[] = [];
      for (let i = 0; i < n; i++) out.push(centre, at(i), at(i + 1));
      return out;
    },
  };
}

/** A box from `min` to `max`. */
function box(min: Point, max: Point): Piece {
  return {
    triangles: (grow) => {
      const [x0, y0] = [min[0] - grow, min[1] - grow];
      const [x1, y1] = [max[0] + grow, max[1] + grow];
      return [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y0],
        [x1, y1],
        [x0, y1],
      ];
    },
  };
}

/**
 * A curved band along a quadratic curve from `a` (through `via`) to `b`,
 * half as wide as `from` at the start and `to` at the end, with a round end.
 */
function band(a: Point, via: Point, b: Point, from: number, to: number): Piece {
  return {
    triangles: (grow, detail) => {
      const steps = Math.max(6, detail);
      const point = (t: number): Point => {
        const u = 1 - t;
        return [
          u * u * a[0] + 2 * u * t * via[0] + t * t * b[0],
          u * u * a[1] + 2 * u * t * via[1] + t * t * b[1],
        ];
      };
      const side = (t: number): Point => {
        const u = 1 - t;
        const dx = 2 * u * (via[0] - a[0]) + 2 * t * (b[0] - via[0]);
        const dy = 2 * u * (via[1] - a[1]) + 2 * t * (b[1] - via[1]);
        const len = Math.hypot(dx, dy) || 1;
        return [-dy / len, dx / len];
      };
      const half = (t: number) => from + (to - from) * t + grow;
      const out: Point[] = [];
      for (let i = 0; i < steps; i++) {
        const [t0, t1] = [i / steps, (i + 1) / steps];
        const [p0, p1] = [point(t0), point(t1)];
        const [n0, n1] = [side(t0), side(t1)];
        const [h0, h1] = [half(t0), half(t1)];
        const l0: Point = [p0[0] + n0[0] * h0, p0[1] + n0[1] * h0];
        const r0: Point = [p0[0] - n0[0] * h0, p0[1] - n0[1] * h0];
        const l1: Point = [p1[0] + n1[0] * h1, p1[1] + n1[1] * h1];
        const r1: Point = [p1[0] - n1[0] * h1, p1[1] - n1[1] * h1];
        out.push(l0, r0, r1, l0, r1, l1);
      }
      // The start hides in the stem; the end is rounded.
      out.push(...ellipse(b, to, to, 0).triangles(grow, detail));
      return out;
    },
  };
}

/**
 * The glyphs, drawn in their own units with y up and x to the viewer's
 * right. Only their proportions matter: every glyph is scaled to one unit tall.
 */
const GLYPHS: Readonly<Record<FloaterGlyph, readonly Piece[]>> = {
  // An eighth note (♪): a round head tipped up to the right, a thick stem
  // from its right side, and a fat curved flag. Chunky, so it reads small.
  'music-note': [
    ellipse([0, 0], 0.32, 0.23, (20 * Math.PI) / 180),
    box([0.17, 0.04], [0.31, 1.28]),
    band([0.24, 1.26], [0.68, 1.02], [0.58, 0.6], 0.14, 0.08),
  ],
};

/** Geometry for one glyph at one detail level, one unit tall, centred on the origin. */
export function floaterArrays(glyph: FloaterGlyph, lod: LodSettings): FloaterArrays {
  const pieces = GLYPHS[glyph];
  const detail = lod.partSegments;
  const flat = (grow: number) => pieces.flatMap((p) => p.triangles(grow, detail));
  const fillHeight = span(flat(0))[1];
  const outline = flat(FLOATER.outline * fillHeight);
  const fill = flat(0);
  const [, height, mid] = span(outline);
  const k = 1 / height;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const [sr, sg, sb] = FLOATER.outlineShade;
  const layer = (points: Point[], z: number, rgb: readonly [number, number, number]) => {
    for (const [x, y] of points) {
      indices.push(positions.length / 3);
      positions.push((x - mid[0]) * k, (y - mid[1]) * k, z);
      normals.push(0, 0, -1);
      colors.push(rgb[0], rgb[1], rgb[2], 1);
    }
  };
  layer(outline, 0, [sr, sg, sb]);
  layer(fill, -FLOATER.layerGap, [1, 1, 1]);
  const mesh = orientTriangles({ positions, normals, indices });
  return { ...mesh, colors };
}

/** Width, height and middle of a set of points. */
function span(points: readonly Point[]): [number, number, Point] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x1 - x0, y1 - y0, [(x0 + x1) / 2, (y0 + y1) / 2]];
}
