import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { logPoint } from './coast-kit.js';
import { box, kitMesh, merged, Part } from './kit-mesh.js';
import { cylinder, flat, shaded, sphere } from './land-kit.js';
import type { ExtrasContext, Growth } from './land-layout.js';
import type { SpotShape } from './trail-kit.js';
import type { LandOptions } from './explore-land.js';
import { EXPLORE_VIEW } from './explore-config.js';
import { bankReach } from './land-shape.js';
import { BANK, bankRadius, CROSSINGS, farBankRadius, REED_CLEAR, RIVER } from './river-config.js';

// The river bank's shapes (#621 W1-13), on the meadow's kit like the coast's:
// the same vinyl-toy primitives, vertex-coloured from a darker foot to a
// sunlit top (art bible §4), one merged mesh each. The tile is the bank: its
// back runs down a pebbly shore into clear shallows (`BANK`, shaped by the
// land), and past the Keeper's clamp the river runs deep round a lazy bend.
// The water, the ripples running with the current, the far bank and the mist
// are layers placed once at the middle (the land's middle is at 0); the
// jetty and its lantern are placed at the land's jetty, and the reeds and
// rocks are seeded per tile. The four search spots are drawn at world size,
// each on the ground its kind is padded to (`BANK.pads`).

type Layers = NonNullable<LandOptions['extras']>;
type Vec3 = [number, number, number];

/** A small deterministic spread (golden-angle ring), so the river is the same on every device. */
const spread = (i: number): number => (i * 0.61803398875) % 1;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Sets every vertex's alpha (the part's mesh must have `hasVertexAlpha`). */
function faded(part: Part, alpha: number): Part {
  const colors = part.data.colors;
  if (colors) for (let i = 3; i < colors.length; i += 4) colors[i] = alpha;
  return part;
}

/**
 * How far out along bearing `a` the bank reaches `share` of the way to the
 * back edges (`bankReach`), capped at `cap` where the bearing runs past the
 * tile's sides (there the meadow falls straight into the water).
 */
function reachRadius(share: number, a: number, cap: number): number {
  const per = bankReach({ x: Math.cos(a), z: Math.sin(a) }, EXPLORE_VIEW.hexSize);
  return per > 0 ? Math.min(cap, share / per) : cap;
}

/** A point `r` out at bearing `a` (radians), at height `y`. */
const polar = (r: number, a: number, y: number): Vec3 => [Math.cos(a) * r, y, Math.sin(a) * r];

/**
 * The way the water runs at bearing `a`, as a change of bearing per unit of
 * length at radius `r`: left to right across the back is clockwise, so the
 * bearing falls downstream (`RIVER.flow`).
 */
const downstream = (r: number): number => -RIVER.flow / r;

/** Gives a hand-made part the attributes the kit's primitives carry, so they merge. */
function finish(positions: number[], indices: number[], normals?: number[]): Part {
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  if (normals) {
    data.normals = normals;
  } else {
    const computed: number[] = [];
    VertexData.ComputeNormals(positions, indices, computed);
    // Turn the faces up if they came out facing down.
    let up = 0;
    for (let i = 1; i < computed.length; i += 3) up += computed[i] ?? 0;
    if (up < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const b = indices[i + 1] ?? 0;
        indices[i + 1] = indices[i + 2] ?? 0;
        indices[i + 2] = b;
      }
      computed.length = 0;
      VertexData.ComputeNormals(positions, indices, computed);
    }
    data.normals = computed;
  }
  data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
  return new Part(data);
}

/**
 * A flat strip along a path on the water: `at(t)` gives x, z for t in 0…1
 * and `half(t)` its half-width. Both windings, normals up, so it shows
 * whichever way the material culls.
 */
function strip(
  at: (t: number) => [number, number],
  half: (t: number) => number,
  y: number,
  n = 10,
): Part {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const [x, z] = at(t);
    const [x2, z2] = at(Math.min(1, t + 0.01));
    const [x1, z1] = at(Math.max(0, t - 0.01));
    const len = Math.hypot(x2 - x1, z2 - z1) || 1;
    const nx = -(z2 - z1) / len;
    const nz = (x2 - x1) / len;
    const h = half(t);
    positions.push(x + nx * h, y, z + nz * h, x - nx * h, y, z - nz * h);
    if (k < n) {
      const i = k * 2;
      indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3, i, i + 2, i + 1, i + 2, i + 3, i + 1);
    }
  }
  return finish(
    positions,
    indices,
    positions.map((_, i) => (i % 3 === 1 ? 1 : 0)),
  );
}

/** A soft lens: narrow at both ends, widest in the middle. */
const lens = (w: number) => (t: number) => w * Math.sin(Math.PI * t) ** 0.8 + 0.004;

/** An arc of the river `len` long from bearing `a0`, downstream, at radius `r` (plus `drift(t)` outward). */
function arc(r: number, a0: number, len: number, drift: (t: number) => number = () => 0) {
  return (t: number): [number, number] => {
    const a = a0 + downstream(r) * len * t;
    const d = r + drift(t);
    return [Math.cos(a) * d, Math.sin(a) * d];
  };
}

// ── The water ─────────────────────────────────────────────────────────

/**
 * The river: one disc out past the far bank at the water's level, see-through
 * and pale over the shallows' sandy bed, darkening to the deep teal channel
 * past the drop (and back to pale by the far bank), so walkable water and
 * deep water read apart at a glance. It's under the meadow everywhere else.
 */
export function buildRiver(scene: Scene): Mesh {
  const mesh = kitMesh(scene, 'river-water', () => {
    const size = EXPLORE_VIEW.hexSize;
    const rs = bankRadius();
    const rf = farBankRadius();
    const shallow = Color3.FromHexString(RIVER.shallows).toLinearSpace();
    const deep = Color3.FromHexString(RIVER.deep).toLinearSpace();
    const reach = RIVER.shallowReach;
    const rings = 40;
    const around = 96;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
      const r = ring === 0 ? 0 : 2 + ((rf + 2 - 2) * (ring - 1)) / (rings - 1);
      for (let n = 0; n < around; n++) {
        const a = (n / around) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        // Deep past the shallows' drop (or past the meadow's own edge at the
        // sides), pale again by the far bank.
        const e = bankReach({ x, z }, size);
        const out = Math.max(smooth((e - BANK.drop + 0.02) / 0.14), smooth((r - rs + 0.2) / 1.4));
        const k = out * smooth((rf - r) / (reach * 2));
        positions.push(x, RIVER.level, z);
        colors.push(
          shallow.r + (deep.r - shallow.r) * k,
          shallow.g + (deep.g - shallow.g) * k,
          shallow.b + (deep.b - shallow.b) * k,
          RIVER.shallowAlpha + (RIVER.deepAlpha - RIVER.shallowAlpha) * k,
        );
      }
      if (ring === 0) continue;
      for (let n = 0; n < around; n++) {
        const a0 = (ring - 1) * around + n;
        const a1 = (ring - 1) * around + ((n + 1) % around);
        const b0 = ring * around + n;
        const b1 = ring * around + ((n + 1) % around);
        indices.push(a0, b0, a1, a1, b0, b1);
      }
    }
    const part = finish(
      positions,
      indices,
      positions.map((_, n) => (n % 3 === 1 ? 1 : 0)),
    );
    part.data.colors = colors;
    return merged([part]);
  });
  mesh.hasVertexAlpha = true;
  // First of the see-through layers: the lantern's halo and the mist, which
  // sit over it, are sorted by distance and would otherwise draw first and be
  // washed out by the water drawn over them.
  mesh.alphaIndex = 0;
  return mesh;
}

/** Rocks standing in the current, as bearing (degrees), share of the way across, and size. */
export const RIVER_ROCKS: readonly (readonly [number, number, number])[] = [
  [38, 0.55, 0.9],
  [74, 0.3, 0.6],
  [92, 0.7, 1.1],
  [112, 0.45, 0.7],
  [146, 0.62, 0.95],
  [168, 0.35, 0.65],
]; // TUNE

/** A point a `share` of the way across the river at bearing `deg`, and its radius. */
function across(deg: number, share: number): { r: number; a: number } {
  const rs = bankRadius();
  return { r: rs + (farBankRadius() - rs) * share, a: rad(deg) };
}

/**
 * The current's wake behind something `size` across at radius `r`, bearing
 * `a`: two pale streaks peeling away downstream, and a pillow of foam on its
 * upstream face.
 */
function wake(r: number, a: number, size: number): Part[] {
  const y = RIVER.level + 0.014;
  const len = 1.6 + size * 1.2;
  const half = size * 0.38;
  const start = a + downstream(r) * size * 0.3;
  return [
    flat(
      strip(
        arc(r, start, len, (t) => half + t * 0.6),
        lens(0.085),
        y,
      ),
      RIVER.wake,
    ),
    flat(
      strip(
        arc(r, start, len, (t) => -half - t * 0.6),
        lens(0.085),
        y,
      ),
      RIVER.wake,
    ),
    flat(strip(arc(r, start, len * 0.7), lens(0.06), y + 0.002), RIVER.ripple),
    // The pillow: a short pale crescent just upstream.
    flat(
      strip(
        arc(
          r - half,
          a - downstream(r) * size * 0.45,
          size * 0.9,
          (t) => Math.sin(Math.PI * t) * -0.12 + t * half * 2,
        ),
        lens(0.08),
        y,
      ),
      RIVER.wake,
    ),
  ];
}

/**
 * The current, so the river visibly runs: pale streaks along the bend,
 * longer and denser in the fast middle, the wakes behind the rocks and
 * stepping stones, a lapping wash along both banks, and lily pads resting
 * in the slack water by the near bank.
 */
export function buildRipples(scene: Scene): Mesh {
  return kitMesh(scene, 'river-ripples', () => {
    const rs = bankRadius();
    const rf = farBankRadius();
    const parts: Part[] = [];
    const y = RIVER.level + 0.01;
    for (let i = 0; i < RIVER.streaks; i++) {
      const share = 0.12 + spread(i * 7 + 3) * 0.76;
      const r = rs + (rf - rs) * share;
      // Behind the tile and round its sides; the front is under the camera.
      const a = rad(-40 + spread(i) * 260);
      const fast = 1 - Math.abs(share - 0.5) * 2;
      const [lo, hi] = RIVER.streakLength;
      const len = lo + (hi - lo) * (0.4 * spread(i * 3 + 1) + 0.6 * fast);
      parts.push(flat(strip(arc(r, a, len), lens(0.045 + 0.03 * fast), y), RIVER.ripple));
    }
    for (const [deg, share, size] of RIVER_ROCKS) {
      const { r, a } = across(deg, share);
      parts.push(...wake(r, a, size));
    }
    // A lapping wash along the near bank's waterline, round the back of the
    // tile and down its sides: a thin wobbly band, lighter than the shallows.
    const sides = rs + 0.1;
    parts.push(
      flat(
        strip(
          (t) => {
            const a = rad(-25 + t * 230);
            const d =
              reachRadius(BANK.water, a, sides) +
              0.06 * Math.sin(40 * t) +
              0.04 * Math.sin(71 * t + 1);
            return [Math.cos(a) * d, Math.sin(a) * d];
          },
          () => 0.12,
          y + 0.002,
          220,
        ),
        RIVER.ripple,
      ),
    );
    // …and along the far bank.
    for (const [r, phase] of [[rf, 1.3]] as const) {
      parts.push(
        flat(
          strip(
            (t) => {
              const a = t * Math.PI * 2;
              const d = r + 0.08 * Math.sin(9 * a + phase) + 0.05 * Math.sin(17 * a - phase);
              return [Math.cos(a) * d, Math.sin(a) * d];
            },
            () => 0.14,
            y - 0.004,
            160,
          ),
          RIVER.ripple,
        ),
      );
    }
    // Lily pads in the slack water by the near bank, a pink bloom on some.
    for (let i = 0; i < 9; i++) {
      const a = rad(20 + spread(i * 5 + 2) * 140);
      const r = rs + 0.5 + spread(i * 11 + 1) * 0.9;
      const d = 0.34 + spread(i * 13) * 0.2;
      const [x, , z] = polar(r, a, 0);
      parts.push(
        shaded(
          cylinder(0.025, d, d, 10, [x, RIVER.level + 0.02, z]),
          '#5aa64e',
          '#6db35a',
          RIVER.level,
          RIVER.level + 0.04,
        ),
      );
      if (i % 3 === 0) {
        parts.push(
          flat(sphere(0.16, 4, [x + 0.05, RIVER.level + 0.08, z], [1, 0.7, 1]), '#ffb3cf'),
        );
        parts.push(flat(sphere(0.07, 3, [x + 0.05, RIVER.level + 0.13, z]), '#ffe28a'));
      }
    }
    return merged(parts);
  });
}

/** A smooth river rock: grey-green stone, darker and wet at its foot, a cap of moss. */
function riverRock(at: Vec3, size: number, moss = true): Part[] {
  const [x, y, z] = at;
  const parts = [
    shaded(
      sphere(size, 6, [x, y, z], [1.2, 0.55, 1]),
      '#55605c',
      '#b4bcb2',
      y - size * 0.2,
      y + size * 0.28,
    ),
  ];
  if (moss) {
    parts.push(
      shaded(
        sphere(size * 0.62, 5, [x - size * 0.06, y + size * 0.2, z + size * 0.04], [1.15, 0.35, 1]),
        '#5d8a3e',
        '#8dbf5a',
        y + size * 0.16,
        y + size * 0.32,
      ),
    );
  }
  return parts;
}

/** The rocks out in the current (their wakes are in `buildRipples`). */
export function buildRiverRocks(scene: Scene): Mesh {
  return kitMesh(scene, 'river-rocks', () =>
    merged(
      RIVER_ROCKS.flatMap(([deg, share, size], i) => {
        const { r, a } = across(deg, share);
        return riverRock(polar(r, a, RIVER.level + size * 0.06), size, i % 2 === 0);
      }),
    ),
  );
}

// ── The far bank ─────────────────────────────────────────────────────

/**
 * The far bank's height `d` past its waterline, at bearing `a`: a wet foot
 * under the water, a soft climb, then gentle rolls into the haze.
 */
export function farBankHeight(d: number, a: number): number {
  const { rise, slope } = RIVER.farBank;
  if (d < 0) return RIVER.level + 0.06 + d * 0.4;
  const climb = rise * smooth(d / slope);
  const roll = 0.22 * Math.sin(a * 5 + d * 0.35) * smooth((d - slope) / 4);
  const lift = 0.025 * Math.max(0, d - slope);
  return RIVER.level + 0.06 + climb + roll + lift;
}

/** The far bank's ground: one ring of land round the river, coloured from wet mud to sunny grass. */
function farGround(): Part {
  const rf = farBankRadius();
  const { slope, reach } = RIVER.farBank;
  const radii = [
    -1,
    -0.3,
    0.15,
    0.5,
    slope * 0.6,
    slope,
    slope + 1.2,
    4,
    7,
    11,
    17,
    26,
    40,
    reach - rf,
  ];
  const around = 96;
  const mud = Color3.FromHexString(RIVER.farMud).toLinearSpace();
  const grass = RIVER.farGrass.map((h) => Color3.FromHexString(h).toLinearSpace());
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  radii.forEach((d, ring) => {
    for (let n = 0; n < around; n++) {
      const a = (n / around) * Math.PI * 2;
      positions.push(...polar(rf + d, a, farBankHeight(d, a)));
      // Mud at the waterline, then grass from the shaded foot to the sunny tops.
      const g = 0.5 + 0.5 * Math.sin(a * 7 + d * 0.6);
      const top = Color3.Lerp(grass[1] ?? mud, grass[2] ?? mud, g);
      const wet = smooth((d - 0.05) / 0.6);
      const sun = smooth((d - 0.3) / (slope + 0.6));
      const c = Color3.Lerp(mud, Color3.Lerp(grass[0] ?? mud, top, sun), wet);
      colors.push(c.r, c.g, c.b, 1);
    }
    if (ring === 0) return;
    for (let n = 0; n < around; n++) {
      const a0 = (ring - 1) * around + n;
      const a1 = (ring - 1) * around + ((n + 1) % around);
      const b0 = ring * around + n;
      const b1 = ring * around + ((n + 1) % around);
      indices.push(a0, b0, a1, a1, b0, b1);
    }
  });
  const part = finish(positions, indices);
  part.data.colors = colors;
  return part;
}

/** A weeping willow: a stout trunk, a soft domed crown, and long strands hanging to the ground. */
function willow(at: Vec3, s: number, lean: number): Part[] {
  const [x, y, z] = at;
  const parts: Part[] = [
    shaded(
      cylinder(1.8 * s, 0.32 * s, 0.5 * s, 7, [x, y + 0.9 * s, z], [0, 0, lean]),
      '#5e4632',
      '#8a6a4a',
      y,
      y + 1.8 * s,
    ),
  ];
  const top = y + 1.85 * s;
  const cx = x - Math.sin(lean) * 1.2 * s;
  for (const [dx, dy, dz, d] of [
    [0, 0.25, 0, 2.3],
    [0.6, 0, 0.3, 1.6],
    [-0.65, -0.05, -0.2, 1.6],
    [0.1, 0.05, -0.6, 1.5],
  ] as const) {
    parts.push(
      shaded(
        sphere(d * s, 6, [cx + dx * s, top + dy * s, z + dz * s], [1.15, 0.8, 1.15]),
        '#5f8f4a',
        '#a8cf7a',
        top - 0.9 * s,
        top + 1 * s,
      ),
    );
  }
  // Strands drape from the crown's rim nearly to the grass.
  const strands = 22;
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 2 + spread(i) * 0.4;
    const out = (0.95 + spread(i * 3) * 0.35) * s;
    const len = (1.3 + spread(i * 7) * 0.6) * s;
    const sx = cx + Math.cos(a) * out;
    const sz = z + Math.sin(a) * out;
    parts.push(
      shaded(
        // Thick where it hangs from the crown, thin at its tip.
        cylinder(len, 0.13 * s, 0.035 * s, 4, [sx, top - 0.2 * s - len / 2, sz]),
        '#7fae5c',
        '#a5cf78',
        top - len,
        top,
      ),
    );
  }
  return parts;
}

/** A round far-off tree: a trunk and a lollipop crown, cheap, for the hazy distance. */
function farTree(at: Vec3, s: number, shade: number): Part[] {
  const [x, y, z] = at;
  const tops = ['#6f9c55', '#7fae62', '#5f8d4c'] as const;
  return [
    shaded(
      cylinder(1.4 * s, 0.25 * s, 0.35 * s, 5, [x, y + 0.7 * s, z]),
      '#5e4632',
      '#7c5d40',
      y,
      y + 1.4 * s,
    ),
    shaded(
      sphere(2.2 * s, 5, [x, y + 2.1 * s, z], [1, 1.05, 1]),
      '#4f7a3f',
      tops[shade % 3] ?? '#7fae62',
      y + 1.1 * s,
      y + 3.2 * s,
    ),
  ];
}

/** A cattail clump: thin blade leaves and a few brown velvet heads on tall stems. */
function cattailClump(at: Vec3, s: number, seed: number): Part[] {
  const [x, y, z] = at;
  const parts: Part[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + seed;
    const h = (0.8 + spread(i + seed * 3) * 0.5) * s;
    const lean = 0.18 + spread(i * 5 + seed) * 0.18;
    parts.push(
      shaded(
        cylinder(
          h,
          0.015 * s,
          0.07 * s,
          3,
          [x + Math.cos(a) * 0.12 * s, y + h / 2, z + Math.sin(a) * 0.12 * s],
          [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
        ),
        '#4f7a35',
        '#9ccc62',
        y,
        y + h,
      ),
    );
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + seed * 1.7;
    const h = (1.05 + spread(i * 3 + seed) * 0.35) * s;
    const px = x + Math.cos(a) * 0.08 * s;
    const pz = z + Math.sin(a) * 0.08 * s;
    parts.push(
      shaded(
        cylinder(h, 0.02 * s, 0.03 * s, 3, [px, y + h / 2, pz]),
        '#5b8a3a',
        '#8fbf58',
        y,
        y + h,
      ),
    );
    parts.push(
      shaded(
        cylinder(0.26 * s, 0.1 * s, 0.1 * s, 6, [px, y + h - 0.08 * s, pz]),
        '#6a4528',
        '#9a6a3e',
        y + h - 0.2 * s,
        y + h,
      ),
    );
    parts.push(
      flat(cylinder(0.12 * s, 0.006 * s, 0.012 * s, 3, [px, y + h + 0.1 * s, pz]), '#8fbf58'),
    );
  }
  return parts;
}

/** The rope swing: a branch reaching out over the water, a rope and a plank seat. */
function ropeSwing(): Part[] {
  const rf = farBankRadius();
  const a = rad(CROSSINGS.swing);
  const base = rf + 1.4;
  const parts: Part[] = [...willow(polar(base, a, farBankHeight(1.4, a)), 1.05, 0.05)];
  // A bough from the trunk out over the river, sloping gently down.
  const from = polar(base - 0.2, a, farBankHeight(1.4, a) + 2);
  const to = polar(rf - 1.7, a, farBankHeight(1.4, a) + 1.85);
  const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  const len = Math.hypot(to[0] - from[0], to[2] - from[2]);
  parts.push(
    shaded(
      cylinder(len, 0.14, 0.24, 6, mid, [0, Math.PI - a, Math.PI / 2]),
      '#5e4632',
      '#8a6a4a',
      mid[1] - 0.1,
      mid[1] + 0.12,
    ),
  );
  // Two ropes down to a little seat just above the water.
  const seatY = RIVER.level + 0.75;
  const hang = polar(rf - 1.35, a, 0);
  const side: [number, number] = [-Math.sin(a) * 0.22, Math.cos(a) * 0.22];
  const ropeTop = to[1] + 0.05;
  for (const k of [-1, 1] as const) {
    const rx = hang[0] + side[0] * k;
    const rz = hang[2] + side[1] * k;
    parts.push(
      flat(cylinder(ropeTop - seatY, 0.035, 0.035, 4, [rx, (ropeTop + seatY) / 2, rz]), '#d9b77a'),
    );
  }
  const seat = box({ width: 0.62, height: 0.06, depth: 0.22 });
  seat.position.set(hang[0], seatY, hang[2]);
  seat.rotation.set(0, Math.PI / 2 - a + Math.PI / 2, 0);
  parts.push(shaded(seat, '#8a6440', '#c49a68', seatY - 0.03, seatY + 0.03));
  return parts;
}

/** Bearings the far bank keeps clear for the swing. */
const KEEP_CLEAR = [CROSSINGS.swing] as const;
const clearOf = (deg: number, by: number) => KEEP_CLEAR.every((c) => Math.abs(deg - c) > by);

/**
 * The far bank across the river: its grassy ground, willows weeping over the
 * water, cattails along its edge, rounder trees fading into the haze behind,
 * and the rope swing.
 */
export function buildFarBank(scene: Scene): Mesh {
  return kitMesh(scene, 'river-far-bank', () => {
    const rf = farBankRadius();
    const parts: Part[] = [farGround()];
    for (const [deg, out, s] of [
      [60, 2.2, 0.85],
      [124, 2.4, 0.9],
      [146, 2.2, 0.85],
      [160, 3.4, 1.05],
      [18, 3.2, 0.9],
    ] as const) {
      const a = rad(deg);
      parts.push(
        ...willow(polar(rf + out, a, farBankHeight(out, a)), s, (spread(deg) - 0.5) * 0.12),
      );
    }
    parts.push(...ropeSwing());
    for (let i = 0; i < 12; i++) {
      const deg = 10 + spread(i * 3 + 1) * 160;
      const out = 7 + spread(i * 7 + 2) * 9;
      const a = rad(deg);
      parts.push(
        ...farTree(polar(rf + out, a, farBankHeight(out, a) - 0.1), 0.9 + spread(i) * 0.6, i),
      );
    }
    for (let i = 0; i < 18; i++) {
      const deg = 5 + spread(i * 5 + 4) * 170;
      if (!clearOf(deg, 5)) continue;
      const out = 0.05 + spread(i * 9 + 1) * 0.5;
      const a = rad(deg);
      parts.push(...cattailClump(polar(rf + out, a, farBankHeight(out, a) - 0.04), 1.1, i));
    }
    return merged(parts);
  });
}

// ── The jetty ────────────────────────────────────────────────────────

/**
 * The jetty is built along +z from its foot at the waterline (the origin, at
 * the water's level) out over the shallows; its instance turns it to the
 * land's jetty (`BankField.jetty`). The Keeper walks on its deck.
 */
const JETTY = BANK.jetty;

/** The lantern post on the jetty's end: its top, and where its lantern hangs. */
function lanternPost() {
  const x = JETTY.width / 2 - 0.04;
  const z = JETTY.length - 0.14;
  const top = JETTY.deck + 1.05;
  const lamp: Vec3 = [x, top - 0.32, z + 0.28];
  return { x, z, top, lamp };
}

/** A little wooden jetty out over the shallows: plank deck, stringers, posts and a lantern post. */
function jettyParts(): Part[] {
  const { length, width, deck } = JETTY;
  const parts: Part[] = [];
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const plank = box({ width: width + 0.1, height: 0.07, depth: length / planks - 0.05 });
    plank.position.set(0, deck - 0.035, ((i + 0.5) / planks) * length);
    plank.rotation.set(0, (spread(i) - 0.5) * 0.05, 0);
    parts.push(shaded(plank, '#8a6440', i % 2 ? '#c49a68' : '#b98f5e', deck - 0.07, deck));
  }
  const foot = -BANK.floor - 0.2;
  for (const k of [-1, 1] as const) {
    const rail = box({ width: 0.09, height: 0.1, depth: length });
    rail.position.set((width / 2 - 0.06) * k, deck - 0.11, length / 2);
    parts.push(shaded(rail, '#5c4430', '#7c5d40', deck - 0.16, deck - 0.06));
    for (const z of [0.12, length * 0.55, length - 0.1]) {
      const top = deck + 0.05;
      parts.push(
        shaded(
          cylinder(top - foot, 0.13, 0.15, 6, [(width / 2 + 0.02) * k, (top + foot) / 2, z]),
          '#4c3826',
          '#8a6a4a',
          0,
          top,
        ),
      );
    }
  }
  // The lantern post at the end, a crook and a little lantern frame.
  const post = lanternPost();
  parts.push(
    shaded(
      cylinder(post.top - deck, 0.1, 0.12, 6, [post.x, (post.top + deck) / 2, post.z]),
      '#4c3826',
      '#7c5d40',
      deck,
      post.top,
    ),
    flat(
      cylinder(0.34, 0.05, 0.05, 4, [post.x, post.top - 0.02, post.z + 0.15], [Math.PI / 2, 0, 0]),
      '#4c3826',
    ),
    flat(
      cylinder(0.05, 0.22, 0.26, 6, [post.lamp[0], post.lamp[1] + 0.15, post.lamp[2]]),
      '#3d3340',
    ),
    flat(
      cylinder(0.04, 0.24, 0.24, 6, [post.lamp[0], post.lamp[1] - 0.14, post.lamp[2]]),
      '#3d3340',
    ),
  );
  return parts;
}

export function buildJetty(scene: Scene): Mesh {
  return kitMesh(scene, 'river-jetty', () => merged(jettyParts()));
}

/** The jetty lantern's warm glass, lit from inside (its own layer, so it glows brighter at dusk). */
export function buildLantern(scene: Scene): Mesh {
  return kitMesh(scene, 'river-lantern', () => {
    const { lamp } = lanternPost();
    return merged([flat(sphere(0.24, 5, lamp, [1, 1.15, 1]), '#ffc861')]);
  });
}

/**
 * The lantern's soft halo once it's lit: nested shells of warm light, fainter
 * outwards, so it glows brightest round the glass and fades out about three
 * times the lantern's size, in many small steps so no shell's edge shows.
 * Drawn after the water (`buildRiver`), without writing depth, so the shells
 * add up softly.
 */
export function buildLanternHalo(scene: Scene): Mesh {
  const mesh = kitMesh(scene, 'river-lantern-halo', () => {
    const { lamp } = lanternPost();
    return merged(
      (
        [
          [0.3, 0.12],
          [0.38, 0.1],
          [0.46, 0.09],
          [0.54, 0.08],
          [0.62, 0.07],
          [0.7, 0.05],
          [0.78, 0.04],
        ] as const
      ).map(([d, alpha]) => faded(flat(sphere(d, 8, lamp), '#ffd27a'), alpha)), // TUNE
    );
  });
  mesh.hasVertexAlpha = true;
  return mesh;
}

/**
 * Wisps of mist lying low on the water at dusk (lightly spooky): wide, flat
 * and faint, each a few stacked discs, smaller and fainter upwards, so its
 * edge fades out instead of ending hard. Out over the shallows' far side and
 * the deep, clear of the shore and the spots' pads.
 */
export function buildMist(scene: Scene): Mesh {
  const mesh = kitMesh(scene, 'river-mist', () => {
    const rs = bankRadius();
    const rf = farBankRadius();
    const parts: Part[] = [];
    for (let i = 0; i < 14; i++) {
      const a = rad(20 + spread(i * 3 + 2) * 140);
      const r = rs - 0.4 + spread(i * 7 + 1) * (rf - rs + 0.4);
      const d = 1.6 + spread(i * 11) * 1.2;
      const y = RIVER.level + 0.16 + spread(i * 5) * 0.1;
      for (const [k, alpha] of [
        [1, 0.2],
        [0.72, 0.17],
        [0.45, 0.14],
      ] as const) {
        const at = polar(r, a, y + (1 - k) * 0.05);
        parts.push(faded(flat(sphere(d * k, 12, at, [1.6, 0.02, 1]), '#d6d0ff'), alpha)); // TUNE
      }
    }
    return merged(parts);
  });
  mesh.hasVertexAlpha = true;
  return mesh;
}

// ── The near bank ────────────────────────────────────────────────────

/** A clump of reeds and cattails for the near bank's rim. */
export function buildBankReeds(scene: Scene): Mesh {
  return kitMesh(scene, 'river-bank-reeds', () => merged(cattailClump([0, -0.02, 0], 0.95, 1)));
}

/** A mossy bank rock half sunk in the grass. */
export function buildBankRocks(scene: Scene): Mesh {
  return kitMesh(scene, 'river-bank-rocks', () =>
    merged([
      ...riverRock([0, 0.08, 0], 0.8),
      shaded(sphere(0.4, 4, [0.45, 0.06, 0.2], [1.1, 0.6, 1]), '#5c645e', '#b4bcb2', 0, 0.2),
    ]),
  );
}

/**
 * Whether a place is clear of every spot's collider by `gap` more, all the
 * way along `front` towards the camera (-z) too: the Keeper stands round a
 * spot to search, and the camera looks over its shoulder, so anything tall
 * in that strip would hide it.
 */
function clear(ctx: ExtrasContext, x: number, z: number, gap: number, front: number): boolean {
  return !ctx.colliders.some((k) => {
    const dz = z - Math.min(k.z, Math.max(k.z - front, z));
    return Math.hypot(x - k.x, dz) < k.r + gap;
  });
}

/**
 * `count` places on the bank between `from` and `to` of the way to its back
 * edges (`bankReach`), `gap` apart and clear of the spots (`clear`, by `gap`
 * unless `spots` says otherwise) and the jetty.
 */
function onBank(
  ctx: ExtrasContext,
  count: number,
  from: number,
  to: number,
  scale: [number, number],
  gap: number,
  spots: { readonly gap: number; readonly front: number } = { gap, front: 0 },
): Growth[] {
  const jetty = ctx.land.bank?.jetty ?? null;
  const offJetty = (x: number, z: number) => {
    if (!jetty) return true;
    const along = Math.min(
      jetty.length,
      Math.max(0, (x - jetty.x) * Math.cos(jetty.angle) + (z - jetty.z) * Math.sin(jetty.angle)),
    );
    const px = jetty.x + Math.cos(jetty.angle) * along;
    const pz = jetty.z + Math.sin(jetty.angle) * along;
    return Math.hypot(x - px, z - pz) > BANK.jetty.width / 2 + gap;
  };
  const out: Growth[] = [];
  const between = (lo: number, hi: number) => lo + ctx.rand() * (hi - lo);
  const half = ctx.size * 0.866;
  for (let tries = 0; out.length < count && tries < count * 200; tries++) {
    const x = between(-half, half);
    const z = between(0, ctx.size);
    const e = bankReach({ x, z }, ctx.size);
    if (e < from || e > to || Math.abs(x) > half - 0.3) continue;
    if (!clear(ctx, x, z, spots.gap, spots.front) || !offJetty(x, z)) continue;
    if (out.some((g) => Math.hypot(g.x - x, g.z - z) < gap * 1.6)) continue;
    out.push({ x, z, yaw: ctx.rand() * Math.PI * 2, scale: between(scale[0], scale[1]) });
  }
  return out;
}

function riverPlace(ctx: ExtrasContext): Readonly<Record<string, readonly Growth[]>> {
  // Reeds growing in the shallows just past the waterline, off the spots and the jetty.
  // They stand well off the camera's side of each spot, so none hides the Keeper searching there.
  const reeds = onBank(
    ctx,
    10,
    BANK.water + 0.03,
    BANK.water + 0.17,
    [0.75, 1.05],
    0.5,
    REED_CLEAR,
  );
  for (const g of reeds) ctx.shade(g.x, g.z, 0.4 * g.scale, 1 * g.scale);
  // A few mossy rocks on the pebbly shore.
  const rocks = onBank(ctx, 4, BANK.shore + 0.02, BANK.water - 0.03, [0.6, 0.9], 0.6);
  for (const r of rocks) ctx.shade(r.x, r.z, 0.7 * r.scale, 0.4 * r.scale);
  // The river and everything on it: one place each, at the middle (they are built round it).
  const middle = [{ x: 0, z: 0, yaw: 0, scale: 1 }];
  // The jetty, its lantern and halo at the land's jetty, turned to run out over the water.
  const jetty = ctx.land.bank?.jetty;
  const pier = jetty ? [{ x: jetty.x, z: jetty.z, yaw: Math.PI / 2 - jetty.angle, scale: 1 }] : [];
  return {
    river: middle,
    ripples: middle,
    'river-rocks': middle,
    'far-bank': middle,
    mist: middle,
    jetty: pier,
    lantern: pier,
    'lantern-halo': pier,
    'bank-reeds': reeds,
    'bank-rocks': rocks,
  };
}

/** The river's own layers, in the shape `ExploreLand` takes. */
export const RIVER_EXTRAS: Layers = {
  place: riverPlace,
  layers: {
    river: { build: buildRiver },
    ripples: { build: buildRipples },
    'river-rocks': { build: buildRiverRocks },
    'far-bank': { build: buildFarBank },
    mist: { build: buildMist, glow: 1.2, darkOnly: true }, // TUNE: faint, lavender
    jetty: { build: buildJetty },
    lantern: { build: buildLantern, glow: 1.1, dusk: 2.6 }, // TUNE: a warm dot by day, bright at dusk
    'lantern-halo': { build: buildLanternHalo, glow: 1.4, darkOnly: true }, // TUNE
    'bank-reeds': { build: buildBankReeds, sway: 0.05 }, // TUNE: a riverside breeze
    'bank-rocks': { build: buildBankRocks },
  },
};

// ── The four search spots, world size, foot at the origin ─────────────

/** A mossy log: a fat old log on the grass, moss on its back, toadstools in front, and a dark gap under one end to peek into. */
function buildMossyLog(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'river-spot-mossy-log', () => {
    const log = {
      length: 1.2,
      top: 0.5,
      bottom: 0.58,
      at: [0, 0.3, 0.05] as Vec3,
      tilt: [0, 0.4, Math.PI / 2 - 0.08] as Vec3,
    };
    // The cut end and its ring sit on the log's own end, however it is turned.
    const end = logPoint(log, -0.5 - 0.012 / log.length);
    const ring = logPoint(log, -0.5 - 0.02 / log.length);
    const parts: Part[] = [
      // A dark hollow under the raised end.
      flat(sphere(0.55, 5, [0.42, 0.02, -0.1], [1.3, 0.2, 1]), '#3a2e26'),
      shaded(
        cylinder(log.length, log.top, log.bottom, 9, log.at, log.tilt),
        '#5c4430',
        '#96734f',
        0.02,
        0.58,
      ),
      flat(
        cylinder(0.02, end.diameter * 0.86, end.diameter * 0.86, 9, end.at, log.tilt),
        '#e2c99a',
      ),
      flat(
        cylinder(0.02, ring.diameter * 0.42, ring.diameter * 0.42, 9, ring.at, log.tilt),
        '#c9a774',
      ),
    ];
    for (const t of [-0.32, -0.16, 0, 0.16, 0.3]) {
      const { at } = logPoint(log, t);
      parts.push(
        shaded(
          sphere(0.36, 5, [at[0], at[1] + 0.21, at[2]], [1.2, 0.3, 1.1]),
          '#557f36',
          '#94c65c',
          at[1] + 0.16,
          at[1] + 0.32,
        ),
      );
    }
    // Red toadstools on the camera's side of the log.
    for (const [x, z, h, cap] of [
      [-0.05, -0.52, 0.2, 0.3],
      [0.26, -0.46, 0.15, 0.22],
      [-0.32, -0.44, 0.12, 0.18],
    ] as const) {
      parts.push(flat(cylinder(h, 0.07, 0.08, 6, [x, h / 2, z]), '#f2e2c8'));
      parts.push(
        shaded(
          sphere(cap, 5, [x, h + 0.02, z], [1, 0.6, 1]),
          '#c94a3c',
          '#ff7a66',
          h - 0.03,
          h + 0.08,
        ),
      );
      parts.push(flat(sphere(cap * 0.22, 3, [x + cap * 0.2, h + 0.08, z - cap * 0.1]), '#fff4ea'));
      parts.push(
        flat(sphere(cap * 0.18, 3, [x - cap * 0.18, h + 0.07, z - cap * 0.12]), '#fff4ea'),
      );
    }
    return merged(parts);
  });
  return { mesh, glint: 0.6 };
}

/** A pebble bar: a damp gravel bank heaped with round river pebbles, one speckled blue stone on top. */
function buildPebbleBar(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'river-spot-pebble-bar', () => {
    const parts: Part[] = [
      shaded(sphere(1.3, 7, [0, -0.02, 0], [1.1, 0.34, 1]), '#8f8370', '#c9bea8', -0.05, 0.2),
    ];
    const tones = [
      ['#6f736e', '#d4d7ce'],
      ['#8a7a66', '#e6d6bc'],
      ['#5f6d74', '#c4d2d8'],
      ['#957f72', '#efd8ca'],
    ] as const;
    // Two layers of pebbles: a ring round the heap's foot and a crown on top.
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996;
      const r = 0.55 * Math.sqrt((i + 0.5) / 26);
      const d = 0.17 + spread(i * 5 + 1) * 0.12;
      const y = 0.2 - r * 0.28;
      const [lo, hi] = tones[i % tones.length] ?? tones[0];
      parts.push(
        shaded(
          sphere(d, 5, [Math.cos(a) * r, y, Math.sin(a) * r], [1.2, 0.7, 1]),
          lo,
          hi,
          y - 0.03,
          y + d * 0.35,
        ),
      );
    }
    // The special one: a round blue stone with pale speckles, on top and to the front.
    parts.push(
      shaded(sphere(0.34, 6, [0.02, 0.3, -0.1], [1.15, 0.7, 1]), '#4d6688', '#8fb2e0', 0.2, 0.42),
    );
    for (const [x, z] of [
      [-0.04, -0.2],
      [0.1, -0.16],
      [0.0, -0.06],
      [0.12, -0.04],
    ] as const) {
      parts.push(flat(sphere(0.05, 3, [x, 0.4, z]), '#f2f6ff'));
    }
    return merged(parts);
  });
  return { mesh, glint: 0.45 };
}

/** How far over a spot's foot the water's surface is, for a kind padded under it (`BANK.pads`). */
const surface = (kind: string): number => -(BANK.pads[kind] ?? 0);

/**
 * A little orange fish lying flat in the water at `at`, swimming along
 * `heading` (radians, from +x towards +z): a plump body, a fanned tail and a
 * dark eye, all low, so from the camera it reads as a fish seen from above.
 */
function fish(at: Vec3, heading: number): Part[] {
  const [x, y, z] = at;
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  // Babylon's yaw turns +x towards -z.
  const yaw = -heading;
  const body = sphere(0.3, 5, [x, y, z], [1, 0.2, 0.46]);
  body.rotation.y = yaw;
  const tail = sphere(0.16, 4, [x - dx * 0.19, y, z - dz * 0.19], [0.55, 0.12, 1]);
  tail.rotation.y = yaw;
  return [
    shaded(body, '#d9582a', '#ff9a4d', y - 0.03, y + 0.03),
    shaded(tail, '#e8743a', '#ffb067', y - 0.02, y + 0.02),
    flat(
      sphere(0.045, 3, [x + dx * 0.09 - dz * 0.05, y + 0.025, z + dz * 0.09 + dx * 0.05]),
      '#2b2230',
    ),
  ];
}

/**
 * A swirly eddy out in the shallows: a darker, deeper swirl on the water's
 * surface, its ripples curling in a spiral, smooth stones breaking the
 * surface round it, a little orange fish circling in it and a lily pad.
 */
function buildEddy(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'river-spot-eddy', () => {
    const y = surface('eddy');
    const parts: Part[] = [
      flat(cylinder(0.012, 1.1, 1.1, 20, [0, y + 0.004, 0]), RIVER.deep),
      flat(cylinder(0.012, 0.62, 0.62, 16, [0, y + 0.01, 0]), '#2a8a9a'),
    ];
    for (let arm = 0; arm < 3; arm++) {
      const a0 = (arm / 3) * Math.PI * 2;
      parts.push(
        flat(
          strip(
            (t) => {
              const a = a0 + t * 2.8;
              const r = 0.55 * (1 - t) + 0.05;
              return [Math.cos(a) * r, Math.sin(a) * r];
            },
            (t) => 0.05 * (1 - t) + 0.012,
            y + 0.02,
            16,
          ),
          RIVER.wake,
        ),
      );
    }
    const stones = 7;
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2 + 0.3;
      const d = 0.24 + spread(i * 3 + 2) * 0.12;
      const r = 0.68 + spread(i * 7) * 0.06;
      // Each stone stands on the bed and breaks the surface, wet below and dry on top.
      parts.push(
        shaded(
          sphere(d, 5, [Math.cos(a) * r, y - 0.02, Math.sin(a) * r], [1.2, 1.3, 1]),
          '#3f4a46',
          '#b9bdb2',
          y - 0.02,
          y + d * 0.5,
        ),
      );
    }
    parts.push(
      ...fish([0.2, y + 0.03, 0.12], 2.1),
      shaded(
        cylinder(0.02, 0.3, 0.3, 10, [-0.34, y + 0.02, -0.22]),
        '#3f8a44',
        '#6db35a',
        y,
        y + 0.04,
      ),
      flat(sphere(0.12, 4, [-0.32, y + 0.07, -0.22], [1, 0.7, 1]), '#ffb3cf'),
    );
    return merged(parts);
  });
  return { mesh, glint: 0.4 + surface('eddy') };
}

/** A cattail bed growing in the shallows: a dense stand of reeds and velvety cattails, a dragonfly resting on top. */
function buildCattails(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'river-spot-cattails', () => {
    const y = surface('cattails');
    const parts: Part[] = [];
    for (const [x, z, s, seed] of [
      [0, 0.05, 1.15, 2],
      [0.26, 0.15, 0.95, 5],
      [-0.24, 0.12, 1.0, 9],
      [0.06, -0.22, 0.85, 13],
    ] as const) {
      parts.push(...cattailClump([x, 0.0, z], s, seed));
    }
    // Rings on the water round the stems.
    for (const [x, z, d] of [
      [0.32, -0.18, 0.4],
      [-0.3, -0.12, 0.32],
    ] as const) {
      parts.push(
        flat(
          strip(
            (t) => [
              x + Math.cos(t * Math.PI * 2) * d * 0.5,
              z + Math.sin(t * Math.PI * 2) * d * 0.5,
            ],
            () => 0.025,
            y + 0.01,
            20,
          ),
          RIVER.ripple,
        ),
      );
    }
    const [dx, dy, dz] = [0.08, 1.4, 0.04];
    parts.push(
      flat(cylinder(0.42, 0.045, 0.06, 6, [dx + 0.05, dy, dz], [0, 0, Math.PI / 2]), '#2f78d8'),
      flat(sphere(0.1, 4, [dx - 0.18, dy, dz]), '#1f56a8'),
    );
    for (const [ox, side] of [
      [-0.07, 1],
      [-0.07, -1],
      [0.03, 1],
      [0.03, -1],
    ] as const) {
      parts.push(
        flat(sphere(0.17, 4, [dx + ox, dy + 0.025, dz + side * 0.11], [0.32, 0.05, 1]), '#bfe6ff'),
      );
    }
    return merged(parts);
  });
  return { mesh, glint: 0.5 };
}

/** The river's search spots, drawn in the kit's style (`biome-dressing.ts` adds them to the biome spots). */
export const RIVER_SPOTS: Readonly<Record<string, (scene: Scene) => SpotShape>> = {
  'mossy-log': buildMossyLog,
  'pebble-bar': buildPebbleBar,
  eddy: buildEddy,
  cattails: buildCattails,
};
