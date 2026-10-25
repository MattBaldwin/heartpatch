import { HEX_SIZE } from '../map/map-config.js';
import type { MeshArrays } from '../map/hex-mesh.js';

// The shapes a road is drawn from (#621 W1-6): a low round hub for the tile's
// middle, and one arm that runs from the hub out to the middle of a side. Both
// are small vertex-coloured toys, one pair per level, and the layer places
// every road with thin instances. Plain arrays so the shapes are testable
// without a GPU.

export interface RoadLook {
  readonly width: number;
  readonly height: number;
  readonly hub: number;
  /** The surface and the slab's sides (sRGB hex). */
  readonly top: string;
  readonly side: string;
  /** The edge strips (a dark gravel edge, a light stone kerb), or none; `edgeFrac` of the half-width each. */
  readonly edge: string | null;
  readonly edgeFrac: number;
}

/**
 * Each level: how wide, how thick and what colour (sRGB hex). The three read
 * apart at a glance on a phone: a narrow brown dirt trail, a wider grey
 * gravel road with a dark edge, and a widest paved stone road with a light
 * kerb. TUNE: all of it.
 */
export const ROAD_LOOK: readonly [RoadLook, RoadLook, RoadLook] = [
  {
    width: 0.07,
    height: 0.016,
    hub: 0.06,
    top: '#9a6a3e',
    side: '#7a5230',
    edge: null,
    edgeFrac: 0,
  }, // Path: narrow dirt trail
  {
    width: 0.15,
    height: 0.03,
    hub: 0.12,
    top: '#c8c2b4',
    side: '#8d877b',
    edge: '#5b564e',
    edgeFrac: 0.22,
  }, // Road: wider gravel, dark edge
  {
    width: 0.24,
    height: 0.046,
    hub: 0.19,
    top: '#b4adc9',
    side: '#8c84a5',
    edge: '#fcf9ff',
    edgeFrac: 0.18,
  }, // Paved: stone, light kerb
];

/** From a tile's middle to the middle of a side: where an arm meets the next tile's arm. */
export const ARM_LENGTH = (HEX_SIZE * Math.sqrt(3)) / 2;

const HUB_SIDES = 14;
/** The surface sits this far above its edge strips (TUNE: enough not to z-fight). */
const EDGE_LIFT = 0.004;

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
  // The first top face is the whole width: the edge colour, else the surface.
  b.quad([0, h, -w], [x1, h, -w], [x1, h, w], [0, h, w], look.edge ? linearRgb(look.edge) : top);
  b.quad([0, 0, -w], [x1, 0, -w], [x1, h, -w], [0, h, -w], side);
  b.quad([x1, 0, w], [0, 0, w], [0, h, w], [x1, h, w], side);
  if (look.edge) {
    // The surface, inset from both edges and a hair higher, so the edge shows as a strip.
    const inner = w * (1 - look.edgeFrac);
    const y = h + EDGE_LIFT;
    b.quad([0, y, -inner], [x1, y, -inner], [x1, y, inner], [0, y, inner], top);
  }
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
    b.tri([0, h, 0], t0, t1, look.edge ? linearRgb(look.edge) : top);
    b.quad(p0, p1, t1, t0, side);
  }
  if (look.edge) {
    // The surface inside the edge ring.
    const ri = r * (1 - look.edgeFrac);
    const y = h + EDGE_LIFT;
    for (let i = 0; i < HUB_SIDES; i++) {
      const a0 = (i / HUB_SIDES) * Math.PI * 2;
      const a1 = ((i + 1) / HUB_SIDES) * Math.PI * 2;
      b.tri(
        [0, y, 0],
        [Math.cos(a0) * ri, y, Math.sin(a0) * ri],
        [Math.cos(a1) * ri, y, Math.sin(a1) * ri],
        top,
      );
    }
  }
  return b.arrays();
}

export function clampLevel(level: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(3, Math.round(level))) as 1 | 2 | 3;
}
