import type { LandPalette } from './land-config.js';
import type { Shade } from './land-layout.js';
import { softNoise, unwarp, valueNoise, warp, type LandField } from './land-shape.js';

// The ground's painted texture (#335 art reset): grass in soft drifts of
// colour, sunny rises, specks of clover and tiny flowers, the worn path with
// its rim, and soft shade baked under everything that stands on the land (so
// the low tier, with no shadow map, still grounds every bush and tree).
// Pure: RGBA bytes, sRGB, row by row from −z to +z, texels spaced by `warp`
// like the ground grid (fine in the middle, coarse far out).

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mixTo = (out: Rgb, c: Rgb, t: number): void => {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface PaintInput {
  readonly palette: LandPalette;
  readonly land: LandField;
  readonly shades: readonly Shade[];
  readonly seed: number;
  /** Texels a side. */
  readonly texels: number;
  /** The land's half-width, world units, and the grid's warp. */
  readonly radius: number;
  readonly warp: number;
}

/** World x (or z) at the middle of texel `i` along one side. */
export function texelToWorld(i: number, texels: number, radius: number, w: number): number {
  return unwarp(((i + 0.5) / texels) * 2 - 1, w) * radius;
}

/** The texture coordinate (0–1) of a world x (or z). */
export function worldToUv(x: number, radius: number, w: number): number {
  return (warp(Math.max(-1, Math.min(1, x / radius)), w) + 1) / 2;
}

export function paintGround(input: PaintInput): Uint8Array {
  const { palette, land, shades, seed, texels: n, radius, warp: w } = input;
  const grass = palette.grass.map(rgb);
  const [g0, g1, g2] = grass as [Rgb, Rgb, Rgb];
  const sunny = rgb(palette.sunny);
  const path = rgb(palette.path);
  const pathEdge = rgb(palette.pathEdge);
  const specks = palette.specks.map(rgb);
  const shade = rgb(palette.shade);

  // The shade first, splatted into its own layer (each shade touches few texels).
  const dark = new Float32Array(n * n);
  const toTexel = (x: number) => worldToUv(x, radius, w) * n - 0.5;
  for (const s of shades) {
    // A cast shadow is an ellipse, long along the sun; its box covers the long way.
    const stretch = s.stretch ?? 1;
    const along = s.along ?? { x: 1, z: 0 };
    const reach = s.r * stretch;
    const i0 = Math.max(0, Math.floor(toTexel(s.x - reach)));
    const i1 = Math.min(n - 1, Math.ceil(toTexel(s.x + reach)));
    const j0 = Math.max(0, Math.floor(toTexel(s.z - reach)));
    const j1 = Math.min(n - 1, Math.ceil(toTexel(s.z + reach)));
    for (let j = j0; j <= j1; j++) {
      const dz = texelToWorld(j, n, radius, w) - s.z;
      for (let i = i0; i <= i1; i++) {
        const dx = texelToWorld(i, n, radius, w) - s.x;
        const a = (dx * along.x + dz * along.z) / stretch;
        const b = dx * along.z - dz * along.x;
        const d = Math.hypot(a, b) / s.r;
        if (d >= 1) continue;
        const f = s.strength * (1 - d * d) ** 2;
        const k = j * n + i;
        dark[k] = 1 - (1 - (dark[k] ?? 0)) * (1 - f);
      }
    }
  }

  const out = new Uint8Array(n * n * 4);
  const c: Rgb = [0, 0, 0];
  const xs = Float64Array.from({ length: n }, (_, i) => texelToWorld(i, n, radius, w));
  for (let j = 0; j < n; j++) {
    const z = xs[j] ?? 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i] ?? 0;
      // Drifts of three greens.
      const g = (softNoise(x * 0.22, z * 0.22, seed + 21) + 1) / 2;
      if (g < 0.5) {
        c[0] = g0[0];
        c[1] = g0[1];
        c[2] = g0[2];
        mixTo(c, g1, g * 2);
      } else {
        c[0] = g1[0];
        c[1] = g1[1];
        c[2] = g1[2];
        mixTo(c, g2, (g - 0.5) * 2);
      }
      // Sunny patches, and a fine mottle so the grass never looks flat.
      mixTo(c, sunny, 0.6 * smooth(0.25, 0.75, softNoise(x * 0.09, z * 0.09, seed + 23)));
      const mottle = 1 + 0.05 * valueNoise(x * 2.2, z * 2.2, seed + 25);
      c[0] *= mottle;
      c[1] *= mottle;
      c[2] *= mottle;
      // Specks: one chance in each little cell.
      const cx = Math.floor(x / 0.22);
      const cz = Math.floor(z / 0.22);
      const roll = (valueNoise(cx + 0.5, cz + 0.5, seed + 27) + 1) / 2;
      if (roll > 0.82) {
        const px = (cx + 0.5) * 0.22 + 0.06 * valueNoise(cx, cz, seed + 29);
        const pz = (cz + 0.5) * 0.22 + 0.06 * valueNoise(cz, cx, seed + 29);
        const d = Math.hypot(x - px, z - pz);
        const speck = specks[Math.floor(roll * 977) % specks.length] ?? g2;
        mixTo(c, speck, 0.85 * (1 - smooth(0.035, 0.06, d)));
      }
      // The path: a darker rim, then the worn middle with a little grain.
      const rim = land.pathMask(x, z, 0.32);
      if (rim > 0) {
        mixTo(c, pathEdge, Math.min(1, rim * 1.6) * 0.8);
        const mid = land.pathMask(x, z, 0.14);
        const inner = smooth(0.0, 1.0, mid) * smooth(0, 0.25, rim);
        mixTo(c, path, inner);
        const grain = 1 + 0.06 * valueNoise(x * 6, z * 6, seed + 31) * inner;
        c[0] *= grain;
        c[1] *= grain;
        c[2] *= grain;
      }
      const k = j * n + i;
      mixTo(c, shade, dark[k] ?? 0);
      out[k * 4] = Math.min(255, Math.max(0, Math.round(c[0])));
      out[k * 4 + 1] = Math.min(255, Math.max(0, Math.round(c[1])));
      out[k * 4 + 2] = Math.min(255, Math.max(0, Math.round(c[2])));
      out[k * 4 + 3] = 255;
    }
  }
  return out;
}
