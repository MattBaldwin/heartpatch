import { HEX_SIZE } from '../map/map-config.js';
import type { MeshArrays } from '../map/hex-mesh.js';

// The shapes a road is drawn from (#621 W1-6): a low round hub for the tile's
// middle, and one arm that runs from the hub out to the middle of a side. Both
// are small vertex-coloured toys, one pair per level, and the layer places
// every road with thin instances. Plain arrays so the shapes are testable
// without a GPU.

/** Each level: how wide, how thick and what colour (sRGB hex). TUNE: all of it. */
export const ROAD_LOOK = [
  { width: 0.1, height: 0.022, hub: 0.085, top: '#ecd3a0', side: '#d1b07a' }, // Path: warm sand
  { width: 0.14, height: 0.03, hub: 0.115, top: '#e2b98a', side: '#c4966a' }, // Road: packed earth
  { width: 0.18, height: 0.036, hub: 0.145, top: '#dcd4e6', side: '#b9aecb' }, // Paved: lavender stone
] as const;

/** From a tile's middle to the middle of a side: where an arm meets the next tile's arm. */
export const ARM_LENGTH = (HEX_SIZE * Math.sqrt(3)) / 2;

const HUB_SIDES = 14;

export type Rgb = readonly [number, number, number];

/** sRGB hex to linear RGB (0–1), as the other vertex-coloured meshes. */
export function linearRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.pow(v / 255, 2.2);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

class Builder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly colors: number[] = [];

  /** One flat-shaded quad (own vertices, so each face lights on its own). */
  quad(a: Rgb3, b: Rgb3, c: Rgb3, d: Rgb3, rgb: Rgb): void {
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(...p);
      this.colors.push(rgb[0], rgb[1], rgb[2], 1);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(a: Rgb3, b: Rgb3, c: Rgb3, rgb: Rgb): void {
    const base = this.positions.length / 3;
    for (const p of [a, b, c]) {
      this.positions.push(...p);
      this.colors.push(rgb[0], rgb[1], rgb[2], 1);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  arrays(): MeshArrays {
    return { positions: this.positions, indices: this.indices, colors: this.colors };
  }
}

type Rgb3 = readonly [number, number, number];

/**
 * The arm of a road at `level`: a slab that starts at the hub's middle
 * (x = 0) and runs along +x to a side's middle, lying on y = 0.
 */
export function armArrays(level: number): MeshArrays {
  const look = ROAD_LOOK[clampLevel(level) - 1] ?? ROAD_LOOK[0];
  const w = look.width / 2;
  const h = look.height;
  const top = linearRgb(look.top);
  const side = linearRgb(look.side);
  const x1 = ARM_LENGTH;
  const b = new Builder();
  // Quads wind so every face's normal points out (see road-meshes.test.ts).
  b.quad([0, h, -w], [x1, h, -w], [x1, h, w], [0, h, w], top);
  b.quad([0, 0, -w], [x1, 0, -w], [x1, h, -w], [0, h, -w], side);
  b.quad([x1, 0, w], [0, 0, w], [0, h, w], [x1, h, w], side);
  return b.arrays();
}

/** The hub of a road at `level`: a low round disc on y = 0. */
export function hubArrays(level: number): MeshArrays {
  const look = ROAD_LOOK[clampLevel(level) - 1] ?? ROAD_LOOK[0];
  const r = look.hub;
  const h = look.height * 1.15; // a hair taller than its arms, so it reads as a hub
  const top = linearRgb(look.top);
  const side = linearRgb(look.side);
  const b = new Builder();
  for (let i = 0; i < HUB_SIDES; i++) {
    const a0 = (i / HUB_SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / HUB_SIDES) * Math.PI * 2;
    const p0: Rgb3 = [Math.cos(a0) * r, 0, Math.sin(a0) * r];
    const p1: Rgb3 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    const t0: Rgb3 = [p0[0], h, p0[2]];
    const t1: Rgb3 = [p1[0], h, p1[2]];
    b.tri([0, h, 0], t0, t1, top);
    b.quad(p0, p1, t1, t0, side);
  }
  return b.arrays();
}

export function clampLevel(level: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(3, Math.round(level))) as 1 | 2 | 3;
}
