import type { WorldPoint } from '@heartpatch/shared';

// Geometry for soft, rounded hex tiles (design doc §19: rounded vinyl-toy
// look). Plain arrays with no Babylon, so the shapes are unit-tested; the
// scene turns them into meshes.

/** Babylon-ready vertex arrays. `colors` is RGBA per vertex when present. */
export interface MeshArrays {
  positions: number[];
  indices: number[];
  colors: number[] | null;
}

/** One ring of a lofted hex: a copy of the outline at `scale`, lifted to `y`. */
export interface ProfileRing {
  readonly scale: number;
  readonly y: number;
  /** Vertex alpha for this ring (vertex-coloured meshes only). */
  readonly alpha?: number;
}

const SIN60 = Math.sqrt(3) / 2;

/**
 * Points around a pointy-top hexagon with rounded corners, anticlockwise seen
 * from above (+x east, +z north), starting just past east. `corner` is the
 * corner radius; `radius × sin 60°` rounds it into a circle.
 */
export function roundedHexOutline(radius: number, corner: number, segments: number): WorldPoint[] {
  const arcCentre = radius - corner / SIN60;
  const points: WorldPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((30 + 60 * i) * Math.PI) / 180;
    const cx = Math.cos(a) * arcCentre;
    const cz = Math.sin(a) * arcCentre;
    for (let s = 0; s <= segments; s++) {
      const t = a + ((s / segments - 0.5) * Math.PI) / 3;
      points.push({ x: cx + Math.cos(t) * corner, z: cz + Math.sin(t) * corner });
    }
  }
  return points;
}

export interface LoftOptions {
  /** Corner radius as a fraction of the radius. */
  readonly corner: number;
  /** Segments per rounded corner. */
  readonly segments: number;
  /** A centre point at this height closes the top (omit for an open ring). */
  readonly centre?: { y: number; alpha?: number };
  /** RGB (0–1) for every vertex; alpha comes from each ring. Omit for no colours. */
  readonly rgb?: readonly [number, number, number];
}

/**
 * A rounded hex lofted through `rings` (outermost last): a domed top that
 * rolls over a soft bevel into the side wall, or a flat ring for overlays.
 * Triangles are wound so Babylon's computed normals point up and out (the
 * side its default culling keeps); the tests check it.
 */
export function loftRoundedHex(
  radius: number,
  rings: readonly ProfileRing[],
  options: LoftOptions,
): MeshArrays {
  const outline = roundedHexOutline(radius, radius * options.corner, options.segments);
  const n = outline.length;
  const positions: number[] = [];
  const colors: number[] | null = options.rgb ? [] : null;
  const indices: number[] = [];
  const push = (x: number, y: number, z: number, alpha = 1): void => {
    positions.push(x, y, z);
    if (colors && options.rgb) colors.push(...options.rgb, alpha);
  };

  let first = 0;
  if (options.centre) {
    push(0, options.centre.y, 0, options.centre.alpha);
    first = 1;
    for (let i = 0; i < n; i++) indices.push(0, first + i, first + ((i + 1) % n));
  }
  rings.forEach((ring, j) => {
    for (const p of outline) push(p.x * ring.scale, ring.y, p.z * ring.scale, ring.alpha);
    if (j === 0) return;
    const inner = first + (j - 1) * n;
    const outer = first + j * n;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      indices.push(inner + i, outer + next, inner + next);
      indices.push(inner + i, outer + i, outer + next);
    }
  });
  return { positions, indices, colors };
}
