import {
  HEX_DIRECTIONS,
  hexKey,
  hexToWorld,
  type Hex,
  type HexKey,
  type PublicTile,
  type WorldPoint,
} from '@heartpatch/shared';
import type { MeshArrays } from './hex-mesh.js';
import { findHomeBases, hash01 } from './map-layout.js';

// Soft overlays laid on the continuous ground (terrain pass 2): a tile's glow,
// the selection ring, a lit fire's safe glow, and a territory's border. With
// no hex pucks any more, the grid only shows where it means something.
// Overlays follow the ground's slopes (each vertex at the ground's height plus
// a small lift), so they never float or sink. Pure, so it's unit-tested.

/**
 * What overlays and props stand on: the ground, or the water's surface over
 * a lake (`Ground` is one; the map scene wraps it with the water).
 */
export interface Surface {
  /** Height under a point, or null off the map. */
  heightAt(p: WorldPoint): number | null;
  /** A tile's own height, or null off the map. */
  tileHeight(h: Hex): number | null;
}

/** One ring of a hex overlay: its size (fraction of the hex) and vertex alpha. */
export interface OverlayRing {
  readonly scale: number;
  readonly alpha: number;
}

export interface OverlayOptions {
  readonly size: number;
  /** Height above the ground. */
  readonly lift: number;
  /** Colour (linear RGB) for every vertex. */
  readonly rgb: readonly [number, number, number];
}

/** The 12 outline points of a hex (corner, edge middle, …), anticlockwise from corner 0, at `scale`. */
function outline(h: Hex, size: number, scale: number): { x: number; z: number }[] {
  const c = hexToWorld(h, size);
  const pts: { x: number; z: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((30 + 60 * k) * Math.PI) / 180;
    const b = ((90 + 60 * k) * Math.PI) / 180;
    pts.push({ x: c.x + Math.cos(a) * size * scale, z: c.z + Math.sin(a) * size * scale });
    pts.push({
      x: c.x + ((Math.cos(a) + Math.cos(b)) / 2) * size * scale,
      z: c.z + ((Math.sin(a) + Math.sin(b)) / 2) * size * scale,
    });
  }
  return pts;
}

class Builder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  private readonly ground: Surface;
  private readonly options: OverlayOptions;
  private readonly fallback: (x: number, z: number) => number;
  constructor(
    ground: Surface,
    options: OverlayOptions,
    fallback: (x: number, z: number) => number,
  ) {
    this.ground = ground;
    this.options = options;
    this.fallback = fallback;
  }

  vertex(x: number, z: number, alpha: number): number {
    const y = (this.ground.heightAt({ x, z }) ?? this.fallback(x, z)) + this.options.lift;
    const i = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.colors.push(...this.options.rgb, alpha);
    return i;
  }

  arrays(): MeshArrays {
    return { positions: this.positions, indices: this.indices, colors: this.colors };
  }
}

/**
 * Hex overlays for `tiles`: an optional centre at `centreAlpha`, then each
 * ring (innermost first) joined to the next, following the ground.
 */
export function hexOverlay(
  tiles: readonly Hex[],
  ground: Surface,
  rings: readonly OverlayRing[],
  options: OverlayOptions & { readonly centreAlpha?: number },
): MeshArrays {
  // Off the map's edge (an outline point just past it), use the tile's own height.
  let fallback = 0;
  const b = new Builder(ground, options, () => fallback);
  for (const h of tiles) {
    const c = hexToWorld(h, options.size);
    fallback = ground.tileHeight(h) ?? 0;
    const at = (x: number, z: number, alpha: number) => b.vertex(x, z, alpha);
    let previous: number[] | null = null;
    if (options.centreAlpha !== undefined) {
      const centre = at(c.x, c.z, options.centreAlpha);
      previous = Array.from({ length: 12 }, () => centre);
    }
    for (const ring of rings) {
      const current = outline(h, options.size, ring.scale).map((p) => at(p.x, p.z, ring.alpha));
      if (previous) {
        for (let i = 0; i < 12; i++) {
          const n = (i + 1) % 12;
          const [p0, p1, c0, c1] = [previous[i], previous[n], current[i], current[n]];
          if (p0 === undefined || p1 === undefined || c0 === undefined || c1 === undefined)
            continue;
          if (p0 === p1) b.indices.push(p0, c1, c0);
          else b.indices.push(p0, c1, c0, p0, p1, c1);
        }
      }
      previous = current;
    }
  }
  return b.arrays();
}

/**
 * A territory's soft border: a band just inside every edge of `owned` that
 * faces land owned by someone else (or nobody), opaque at the edge and fading
 * inwards over `width` of the hex. Edges between two of the owner's own tiles
 * get nothing, so a territory reads as one shape, not a grid.
 */
export function territoryBorder(
  owned: readonly Hex[],
  ground: Surface,
  options: OverlayOptions & { readonly width: number; readonly alpha: number },
): MeshArrays {
  const mine = new Set<HexKey>(owned.map(hexKey));
  let fallback = 0;
  const b = new Builder(ground, options, () => fallback);
  for (const h of owned) {
    fallback = ground.tileHeight(h) ?? 0;
    const outer = outline(h, options.size, 0.995);
    const inner = outline(h, options.size, 1 - options.width);
    for (let k = 0; k < 6; k++) {
      const d = HEX_DIRECTIONS[(k + 1) % 6];
      if (!d || mine.has(hexKey({ q: h.q + d.q, r: h.r + d.r }))) continue;
      // Edge k runs corner k → middle → corner k + 1 (outline indices 2k, 2k+1, 2k+2).
      for (const [from, to] of [
        [2 * k, 2 * k + 1],
        [2 * k + 1, (2 * k + 2) % 12],
      ] as const) {
        const o0 = outer[from];
        const o1 = outer[to];
        const i0 = inner[from];
        const i1 = inner[to];
        if (!o0 || !o1 || !i0 || !i1) continue;
        const a = b.vertex(o0.x, o0.z, options.alpha);
        const c = b.vertex(o1.x, o1.z, options.alpha);
        const d0 = b.vertex(i0.x, i0.z, 0);
        const d1 = b.vertex(i1.x, i1.z, 0);
        b.indices.push(d0, c, a, d0, d1, c);
      }
    }
  }
  return b.arrays();
}

/** Two meshes' arrays as one (for one draw call). */
export function joinArrays(a: MeshArrays, b: MeshArrays): MeshArrays {
  const offset = a.positions.length / 3;
  return {
    positions: [...a.positions, ...b.positions],
    indices: [...a.indices, ...b.indices.map((i) => i + offset)],
    colors: a.colors && b.colors ? [...a.colors, ...b.colors] : null,
  };
}

/**
 * Paths out from each home base: from its Heart Seed straight through its
 * ring to `links` of the land tiles two steps out (hash-picked directions, so
 * every device draws the same), never into a lake.
 */
export function homePaths(
  tiles: readonly PublicTile[],
  size: number,
  links: number,
): WorldPoint[][] {
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const routes: WorldPoint[][] = [];
  for (const home of findHomeBases(tiles)) {
    const { seed } = home;
    const dirs = HEX_DIRECTIONS.map((d, i) => ({ d, roll: hash01(seed.q, seed.r, 600 + i) }))
      .filter(({ d }) => {
        const far = byKey.get(hexKey({ q: seed.q + 2 * d.q, r: seed.r + 2 * d.r }));
        return far !== undefined && far.homeSlot === null && far.terrain !== 'lake';
      })
      .sort((a, b) => a.roll - b.roll)
      .slice(0, links);
    for (const { d, roll } of dirs) {
      const a = hexToWorld(seed, size);
      const b = hexToWorld({ q: seed.q + d.q, r: seed.r + d.r }, size);
      const c = hexToWorld({ q: seed.q + 2 * d.q, r: seed.r + 2 * d.r }, size);
      // A gentle bend: the middle nudged sideways, so paths don't look ruled.
      const bend = (roll - 0.5) * 0.35 * size;
      const nx = -(c.z - a.z);
      const nz = c.x - a.x;
      const len = Math.hypot(nx, nz) || 1;
      routes.push([
        // Start just off the Heart Seed, end in the middle of the far tile.
        { x: a.x + (b.x - a.x) * 0.3, z: a.z + (b.z - a.z) * 0.3 },
        { x: b.x + (nx / len) * bend, z: b.z + (nz / len) * bend },
        c,
      ]);
    }
  }
  return routes;
}

/**
 * A soft ribbon along `points` (a path), following the surface: opaque down
 * the middle, fading at its edges and at both ends.
 */
export function pathRibbon(
  points: readonly WorldPoint[],
  surface: Surface,
  options: OverlayOptions & { readonly width: number; readonly alpha: number },
): MeshArrays {
  const b = new Builder(surface, options, () => 0);
  // Resample along the polyline every `step`, smoothing the corners.
  const step = 0.07;
  const samples: WorldPoint[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (!p0 || !p1) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / step));
    for (let s = 0; s < n; s++)
      samples.push({ x: p0.x + ((p1.x - p0.x) * s) / n, z: p0.z + ((p1.z - p0.z) * s) / n });
  }
  const last = points[points.length - 1];
  if (last) samples.push(last);
  const half = options.width / 2;
  let previous: number[] | null = null;
  samples.forEach((p, i) => {
    const prev = samples[Math.max(0, i - 1)] ?? p;
    const next = samples[Math.min(samples.length - 1, i + 1)] ?? p;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    // Fade in and out over the first and last few samples.
    const ends = Math.min(1, i / 3, (samples.length - 1 - i) / 3);
    const a = options.alpha * ends;
    const row = [-1, -0.45, 0.45, 1].map((t) =>
      b.vertex(p.x + nx * half * t, p.z + nz * half * t, Math.abs(t) === 1 ? 0 : a),
    );
    if (previous) {
      for (let k = 0; k < 3; k++) {
        const [p0, p1, c0, c1] = [previous[k], previous[k + 1], row[k], row[k + 1]];
        if (p0 === undefined || p1 === undefined || c0 === undefined || c1 === undefined) continue;
        b.indices.push(p0, c1, c0, p0, p1, c1);
      }
    }
    previous = row;
  });
  return b.arrays();
}
