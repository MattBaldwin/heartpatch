import type { MeshArrays } from '../map/hex-mesh.js';
import { HEX_SIZE } from '../map/map-config.js';
import { linearRgb, type Rgb } from '../roads/road-meshes.js';
import { sideDistance } from './line-layout.js';

// The shapes a Clockwork Isle's wires and rails are drawn from (#874 C4,
// mockup M2): a wooden wire post with a brass cap, half a sagging wire from
// a post out to a tile's side (the next tile's half meets it there), and
// half a rail (two iron rails on wooden sleepers) from a tile's middle out
// to a side. Small vertex-coloured toys (GAME_DESIGN §19); the layer places
// every one with thin instances and tints them per instance (lit or dark
// wire, iron or brass rail). Plain arrays so the shapes are testable
// without a GPU.

/** The look, in model units and sRGB hex. TUNE: all of it. */
export const LINE_LOOK = {
  post: {
    height: 0.36,
    width: 0.052,
    wood: '#8a5a36',
    cap: '#d9a441', // brass
    capHeight: 0.045,
    /** The cross bar the wire hangs from. */
    bar: 0.15,
  },
  wire: {
    thickness: 0.024,
    /** How far the wire dips at the side's middle, below the post's top. */
    sag: 0.07,
    segments: 6,
  },
  rail: {
    gauge: 0.09,
    width: 0.014,
    height: 0.016,
    iron: '#6d6873',
    sleeper: { wood: '#8a5a36', length: 0.17, width: 0.034, height: 0.012, count: 4 },
  },
} as const;

/** The wire's tint by power (multiplies its white vertex colour; drawn unlit). */
export const WIRE_TINT: { readonly lit: Rgb; readonly dark: Rgb } = {
  lit: [1, 0.82, 0.32], // TUNE: a warm Spark glow, day and night
  dark: [0.26, 0.18, 0.15], // TUNE: a cold copper cable
};

/** The rail's tint by level (multiplies its vertex colours): iron, then brass. */
export const RAIL_TINT: readonly [Rgb, Rgb] = [
  [1, 1, 1],
  [1.25, 1.0, 0.55], // TUNE: warms the iron to brass (wood goes a touch golden)
];

/** From a tile's middle to a side's middle. */
export const SIDE = sideDistance(HEX_SIZE);

type P3 = readonly [number, number, number];

class Builder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly colors: number[] = [];

  /** One flat quad, wound so its normal points out (own vertices, so each face lights alone). */
  quad(a: P3, b: P3, c: P3, d: P3, rgb: Rgb): void {
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(...p);
      this.colors.push(rgb[0], rgb[1], rgb[2], 1);
    }
    this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** An axis-aligned box from `min` to `max` (no bottom: it stands on something). */
  box(min: P3, max: P3, rgb: Rgb): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], rgb); // top
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], rgb); // −z
    this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], rgb); // +z
    this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], rgb); // −x
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], rgb); // +x
  }

  arrays(): MeshArrays & { colors: number[] } {
    return { positions: this.positions, indices: this.indices, colors: this.colors };
  }
}

/** A wire post standing on y = 0 at the origin: a wooden pole, a cross bar and a brass cap. */
export function postArrays(): MeshArrays & { colors: number[] } {
  const { height, width, wood, cap, capHeight, bar } = LINE_LOOK.post;
  const w = width / 2;
  const b = new Builder();
  const woodRgb = linearRgb(wood);
  const capRgb = linearRgb(cap);
  b.box([-w, 0, -w], [w, height, w], woodRgb);
  // The cross bar, just under the top, across the post.
  const barY = height - capHeight * 2.2;
  b.box([-w * 0.8, barY, -bar / 2], [w * 0.8, barY + width * 0.7, bar / 2], woodRgb);
  // The brass cap, a little wider than the pole.
  b.box([-w * 1.35, height, -w * 1.35], [w * 1.35, height + capHeight, w * 1.35], capRgb);
  return b.arrays();
}

/** The wire's height at `t` (0 at the post, 1 at the side's middle): a sag that bottoms out mid-span. */
export function wireHeight(t: number): number {
  const top = LINE_LOOK.post.height - LINE_LOOK.post.capHeight * 0.6;
  // Half a parabola: the span's lowest point is where two tiles' halves meet.
  return top - LINE_LOOK.wire.sag * (1 - (1 - t) * (1 - t));
}

/**
 * Half a wire, from a post's top (x = 0) to a side's middle (x = `SIDE`)
 * along +x, sagging as it goes: a thin square cable in `segments` pieces.
 * White, so the instance tint is its colour.
 */
export function spanArrays(): MeshArrays & { colors: number[] } {
  const { thickness, segments } = LINE_LOOK.wire;
  const h = thickness / 2;
  const white: Rgb = [1, 1, 1];
  const b = new Builder();
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const x0 = t0 * SIDE;
    // A hair past the side's middle, so two halves overlap and never gap.
    const x1 = i === segments - 1 ? SIDE + h : t1 * SIDE;
    const y0 = wireHeight(t0);
    const y1 = wireHeight(t1);
    b.quad([x0, y0 + h, -h], [x0, y0 + h, h], [x1, y1 + h, h], [x1, y1 + h, -h], white);
    b.quad([x0, y0 - h, h], [x0, y0 - h, -h], [x1, y1 - h, -h], [x1, y1 - h, h], white);
    b.quad([x0, y0 - h, -h], [x0, y0 + h, -h], [x1, y1 + h, -h], [x1, y1 - h, -h], white);
    b.quad([x1, y1 - h, h], [x1, y1 + h, h], [x0, y0 + h, h], [x0, y0 - h, h], white);
  }
  return b.arrays();
}

/**
 * Half a rail, from a tile's middle (x = 0) to a side's middle along +x,
 * lying on y = 0: wooden sleepers across, two iron rails along.
 */
export function railArmArrays(): MeshArrays & { colors: number[] } {
  const { gauge, width, height, iron, sleeper } = LINE_LOOK.rail;
  const b = new Builder();
  const wood = linearRgb(sleeper.wood);
  const ironRgb = linearRgb(iron);
  const step = SIDE / sleeper.count;
  for (let i = 0; i < sleeper.count; i++) {
    const x = step * (i + 0.5);
    b.box(
      [x - sleeper.width / 2, 0, -sleeper.length / 2],
      [x + sleeper.width / 2, sleeper.height, sleeper.length / 2],
      wood,
    );
  }
  for (const z of [-gauge / 2, gauge / 2]) {
    b.box(
      [0, sleeper.height, z - width / 2],
      [SIDE + width, sleeper.height + height, z + width / 2],
      ironRgb,
    );
  }
  return b.arrays();
}
