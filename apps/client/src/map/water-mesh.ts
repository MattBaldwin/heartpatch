import { HEX_DIRECTIONS, hexKey, hexToWorld, type Hex, type HexKey } from '@heartpatch/shared';
import type { MeshArrays } from './hex-mesh.js';
import { upward, type Rgb } from './ground-mesh.js';

// The lakes' water (terrain pass 2): one surface over every lake tile at the
// water level, deep and dark in the middle of a lake, shallow and clear at
// its shore, with a shore factor per vertex for the shader's foam. Pure (no
// Babylon), so it's unit-tested.

export interface WaterOptions {
  readonly size: number;
  /** Height of the water surface. */
  readonly level: number;
  /** The water reaches this far past the hex (fraction), tucking under the bank. */
  readonly reach: number;
  /** Linear colours and alphas: the middle of a lake, and its shore. */
  readonly deep: { readonly color: Rgb; readonly alpha: number };
  readonly shallow: { readonly color: Rgb; readonly alpha: number };
}

/** The water mesh plus `shore` (0 in open water, 1 where it meets land) per vertex. */
export interface WaterMesh extends MeshArrays {
  readonly shore: number[];
}

/**
 * Water over `lakes`. A vertex is on the shore when it touches a tile that
 * isn't lake; the lake's middle is deep. Shared points are one vertex.
 */
export function waterMesh(lakes: readonly Hex[], options: WaterOptions): WaterMesh {
  const isLake = new Set<HexKey>(lakes.map(hexKey));
  const positions: number[] = [];
  const colors: number[] = [];
  const shore: number[] = [];
  const indices: number[] = [];
  const index = new Map<string, number>();
  const { size, level, reach, deep, shallow } = options;
  const vertex = (x: number, z: number, s: number): number => {
    const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
    const found = index.get(key);
    if (found !== undefined) {
      // A point two lakes share is on the shore if either sees land there.
      shore[found] = Math.max(shore[found] ?? 0, s);
      return found;
    }
    const i = positions.length / 3;
    positions.push(x, level, z);
    shore.push(s);
    index.set(key, i);
    return i;
  };
  const lakeAt = (h: Hex, dir: number): boolean => {
    const d = HEX_DIRECTIONS[((dir % 6) + 6) % 6];
    return d !== undefined && isLake.has(hexKey({ q: h.q + d.q, r: h.r + d.r }));
  };
  for (const h of lakes) {
    const c = hexToWorld(h, size);
    const centre = vertex(c.x, c.z, 0);
    const ring: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = ((30 + 60 * k) * Math.PI) / 180;
      const b = ((90 + 60 * k) * Math.PI) / 180;
      // Corner k touches directions k and k + 1; the middle of edge k, direction k + 1.
      const cornerShore = lakeAt(h, k) && lakeAt(h, k + 1) ? 0 : 1;
      const midShore = lakeAt(h, k + 1) ? 0 : 1;
      // Out past the hex only where the edge meets land, so lakes never overlap.
      const r = (s: number) => size * (s > 0 ? 1 + reach : 1);
      ring.push(
        vertex(c.x + Math.cos(a) * r(cornerShore), c.z + Math.sin(a) * r(cornerShore), cornerShore),
      );
      const mid = { x: (Math.cos(a) + Math.cos(b)) / 2, z: (Math.sin(a) + Math.sin(b)) / 2 };
      ring.push(vertex(c.x + mid.x * r(midShore), c.z + mid.z * r(midShore), midShore));
    }
    for (let i = 0; i < 12; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 12];
      if (a === undefined || b === undefined) continue;
      const at = (i: number) => ({ x: positions[i * 3] ?? 0, z: positions[i * 3 + 2] ?? 0 });
      if (upward(at(centre), at(a), at(b))) indices.push(centre, a, b);
      else indices.push(centre, b, a);
    }
  }
  for (const s of shore) {
    const t = Math.min(1, s);
    colors.push(
      deep.color[0] + (shallow.color[0] - deep.color[0]) * t,
      deep.color[1] + (shallow.color[1] - deep.color[1]) * t,
      deep.color[2] + (shallow.color[2] - deep.color[2]) * t,
      deep.alpha + (shallow.alpha - deep.alpha) * t,
    );
  }
  return { positions, indices, colors, shore };
}
