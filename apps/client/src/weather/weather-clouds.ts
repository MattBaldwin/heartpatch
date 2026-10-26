import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { hash01 } from '../map/map-layout.js';
import { CLOUD_ATTRIBUTE } from './cloud-plugin.js';
import { WEATHER_LOOK } from './weather-config.js';

const { squash, floor, sun, blend, bank: BANK } = WEATHER_LOOK.clouds;

/**
 * [radius, x, y, z, squash] of each puff of the one cloud shape: a wide flat
 * base, then round lumps heaped on top, the biggest in the middle.
 */
const PUFFS = [
  [0.6, 0, -0.04, 0, 0.55],
  [0.5, 0.02, 0.12, 0.02, 0.9],
  [0.4, 0.48, 0.02, 0.1, 0.85],
  [0.38, -0.46, 0.0, -0.08, 0.85],
  [0.32, 0.2, 0.3, -0.16, 0.9],
  [0.3, -0.22, 0.26, 0.2, 0.9],
  [0.28, 0.3, 0.12, 0.34, 0.9],
  [0.28, -0.3, 0.08, -0.36, 0.9],
] as const;

/** Rings and segments of the sphere the cloud is grown from. */
const RINGS = 20;
const SEGMENTS = 32;

/** Polynomial smooth minimum: two distances melted together over `k`. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed distance (roughly) to the puffs melted into one: below 0 inside. */
export function cloudField(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const [r, px, py, pz, sq] of PUFFS) {
    const dx = x - px;
    const dy = (y - py) / (sq * squash);
    const dz = z - pz;
    const one = (Math.sqrt(dx * dx + dy * dy + dz * dz) - r) * sq * squash;
    d = d === Infinity ? one : smin(d, one, blend);
  }
  return d;
}

/** How far from the middle the cloud's surface is along the unit direction (x, y, z). */
function reach(x: number, y: number, z: number): number {
  let inside = 0;
  let outside = 2;
  for (let i = 0; i < 24; i++) {
    const t = (inside + outside) / 2;
    if (cloudField(x * t, y * t, z * t) < 0) inside = t;
    else outside = t;
  }
  return (inside + outside) / 2;
}

/**
 * One cloud: the puffs melted into a single smooth surface (a smooth union of
 * squashed spheres), so no seam or round lobe shows where they meet, with a
 * flat belly (anything below `floor` is pressed up to it). It is grown from
 * one sphere, each vertex pushed out to the surface along its own direction,
 * and its normals come from the field itself, so they match on both sides of
 * the sphere's seam. Each vertex carries its height up the whole cloud and how
 * much it faces the sun, for the shade in cloud-plugin.ts.
 */
export function buildCloud(scene: Scene): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const e = 0.004;
  for (let j = 0; j <= RINGS; j++) {
    const polar = (j / RINGS) * Math.PI;
    for (let i = 0; i <= SEGMENTS; i++) {
      const around = (i / SEGMENTS) * Math.PI * 2;
      const dx = Math.sin(polar) * Math.cos(around);
      const dy = Math.cos(polar);
      const dz = Math.sin(polar) * Math.sin(around);
      const t = reach(dx, dy, dz);
      let x = dx * t;
      let y = dy * t;
      let z = dz * t;
      let nx = cloudField(x + e, y, z) - cloudField(x - e, y, z);
      let ny = cloudField(x, y + e, z) - cloudField(x, y - e, z);
      let nz = cloudField(x, y, z + e) - cloudField(x, y, z - e);
      if (y < floor) {
        // The flat belly: pressed up to the floor and pulled in a touch so
        // its rim tucks under the rounded sides.
        const tuck = 1 - Math.min(0.12, (floor - y) * 0.4);
        x *= tuck;
        z *= tuck;
        y = floor;
        nx = 0;
        ny = -1;
        nz = 0;
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      positions.push(x, y, z);
      normals.push(nx / len, ny / len, nz / len);
    }
  }
  const row = SEGMENTS + 1;
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * row + i;
      const b = a + row;
      // Wound so the outside faces out (Babylon culls the other side).
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return cloudMesh(scene, 'weather-clouds', { positions, normals, indices }, floor);
}

/** A cloud's surface: positions, normals and triangles. */
export interface CloudShape {
  readonly positions: number[];
  readonly normals: number[];
  readonly indices: number[];
}

/**
 * The mesh for a cloud's surface, each vertex carrying its height up the
 * cloud (0 at the flat belly `base`, 1 at the top) and how much it faces the
 * sun, for the shade in cloud-plugin.ts.
 */
function cloudMesh(scene: Scene, name: string, shape: CloudShape, base: number): Mesh {
  const { positions, normals, indices } = shape;
  const n = positions.length / 3;
  let high = base;
  for (let i = 0; i < n; i++) high = Math.max(high, positions[i * 3 + 1] ?? 0);
  const norm = Math.hypot(...sun) || 1;
  const shade = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const facing =
      ((normals[i * 3] ?? 0) * sun[0] +
        (normals[i * 3 + 1] ?? 0) * sun[1] +
        (normals[i * 3 + 2] ?? 0) * sun[2]) /
      norm;
    shade[i * 4] = Math.min(1, Math.max(0, ((positions[i * 3 + 1] ?? 0) - base) / (high - base)));
    shade[i * 4 + 1] = Math.max(0, facing);
  }
  const cloud = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  data.applyToMesh(cloud, false);
  cloud.setVerticesData(CLOUD_ATTRIBUTE, shade, false, 4);
  cloud.isPickable = false;
  cloud.alwaysSelectAsActiveMesh = true;
  return cloud;
}

/** Rings and segments of the sphere a storm's bank is grown from: fine enough for its bumpy top. */
const BANK_RINGS = 40;
const BANK_SEGMENTS = 120;

/**
 * [radius, x, y, z, squash] of each puff of a bank: lumps heaped over its top
 * (a golden-angle spiral over its footprint, the biggest and highest in the
 * middle) and a ring of puffs round its rim that bulge past the slab, so its
 * outline is scalloped from above as well as bumpy from the side. Fixed
 * (seeded), so every storm's bank is the same shape.
 */
const BANK_PUFFS: readonly (readonly [number, number, number, number, number])[] = [
  ...Array.from({ length: BANK.puffs }, (_, i) => {
    const u = Math.sqrt((i + 0.5) / BANK.puffs) * 0.82;
    const a = i * Math.PI * (3 - Math.sqrt(5)) + hash01(i, 7, 91) * 0.5;
    const r = (BANK.size + hash01(i, 3, 92) * BANK.spread) * (1 - 0.35 * u * u);
    const top = BANK.thick * Math.sqrt(Math.max(0, 1 - u * u));
    return [
      r,
      Math.cos(a) * u * BANK.wide,
      top * (0.7 + hash01(i, 5, 93) * 0.3),
      Math.sin(a) * u * BANK.deep,
      BANK.squash,
    ] as const;
  }),
  // Round the far side and the ends only (from just south of east, over the
  // north, to just south of west): the near side stays a straight wall over
  // the flat belly, so the camera sees the belly's hard edge.
  ...Array.from({ length: BANK.rim }, (_, i) => {
    const a = -0.35 + ((i + hash01(i, 11, 94) * 0.4) / BANK.rim) * (Math.PI + 0.7);
    const r = BANK.rimSize * (0.8 + hash01(i, 13, 95) * 0.4);
    return [
      r,
      Math.cos(a) * BANK.wide * 0.94,
      BANK.thick * 0.35,
      Math.sin(a) * BANK.deep * 0.92,
      BANK.squash,
    ] as const;
  }),
];

/**
 * Signed distance (roughly) to a storm's bank: a wide, low slab (a rounded
 * box, so its near side is a straight wall over the belly) with the puffs
 * melted into its top. Below 0 inside.
 */
export function bankField(x: number, y: number, z: number): number {
  // The slab: a rounded box's distance, its middle a little over the belly
  // so the clamp cuts a hard flat edge along the bottom of its sides.
  const round = BANK.round;
  const qx = Math.abs(x) - BANK.wide + round;
  const qy = Math.abs(y - BANK.thick * 0.5) - BANK.thick * 0.6 + round;
  const qz = Math.abs(z) - BANK.deep + round;
  let d =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, qy, qz), 0) -
    round;
  for (const [r, px, py, pz, sq] of BANK_PUFFS) {
    const dx = x - px;
    const dz = z - pz;
    // A puff further off than `d` plus the blend can't change the union:
    // skip it on a cheap bound (its distance is at least this).
    const far = (d + BANK.blend) / sq + r;
    if (dx > far || -dx > far || dz > far || -dz > far) continue;
    const dy = (y - py) / sq;
    d = smin(d, (Math.sqrt(dx * dx + dy * dy + dz * dz) - r) * sq, BANK.blend);
  }
  return d;
}

/**
 * A storm's bank, its belly at y = 0: one surface grown from a sphere
 * stretched to the slab's size (so its vertices spread evenly over the wide
 * top, not bunched in the middle), each vertex pushed out along its own ray
 * to the outermost crossing of the field (so a puff that leans out keeps its
 * bump). Anything below the belly is pressed flat onto it: a hard, flat
 * underside. Normals from the field's gradient. Pure, for the tests.
 */
export function bankShape(): CloudShape {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const e = 0.01;
  const oy = BANK.thick * 0.3;
  // Far enough out along every ray to be outside the slab and its puffs.
  const sx = BANK.wide * 1.25;
  const sy = BANK.thick * 3.2;
  const sz = BANK.deep * 1.4;
  const steps = 20;
  for (let j = 0; j <= BANK_RINGS; j++) {
    const polar = (j / BANK_RINGS) * Math.PI;
    for (let i = 0; i <= BANK_SEGMENTS; i++) {
      const around = (i / BANK_SEGMENTS) * Math.PI * 2;
      const dx = Math.sin(polar) * Math.cos(around) * sx;
      const dy = Math.cos(polar) * sy;
      const dz = Math.sin(polar) * Math.sin(around) * sz;
      // Walk in from outside to the first point inside, then bisect.
      let outside = 1;
      let inside = 0;
      for (let k = steps - 1; k >= 0; k--) {
        const t = k / steps;
        if (bankField(dx * t, oy + dy * t, dz * t) < 0) {
          inside = t;
          break;
        }
        outside = t;
      }
      for (let k = 0; k < 12; k++) {
        const t = (inside + outside) / 2;
        if (bankField(dx * t, oy + dy * t, dz * t) < 0) inside = t;
        else outside = t;
      }
      const t = (inside + outside) / 2;
      const x = dx * t;
      let y = oy + dy * t;
      const z = dz * t;
      let nx = bankField(x + e, y, z) - bankField(x - e, y, z);
      let ny = bankField(x, y + e, z) - bankField(x, y - e, z);
      let nz = bankField(x, y, z + e) - bankField(x, y, z - e);
      if (y < 0) {
        y = 0;
        nx = 0;
        ny = -1;
        nz = 0;
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      positions.push(x, y, z);
      normals.push(nx / len, ny / len, nz / len);
    }
  }
  const row = BANK_SEGMENTS + 1;
  for (let j = 0; j < BANK_RINGS; j++) {
    for (let i = 0; i < BANK_SEGMENTS; i++) {
      const a = j * row + i;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, indices };
}

/** The bank's shape, worked out once (it is the same for every storm). */
let bankOnce: CloudShape | null = null;

/** A storm's bank as a mesh, shaded like the clouds (cloud-plugin.ts). */
export function buildBank(scene: Scene): Mesh {
  bankOnce ??= bankShape();
  return cloudMesh(scene, 'weather-bank', bankOnce, 0);
}

/** The bolt's path, top to bottom, in a 1-tall frame hanging from y = 0; and a short fork off its third kink. */
const BOLT_PATH = [
  [0, 0],
  [-0.12, -0.14],
  [0.06, -0.27],
  [-0.16, -0.43],
  [0.04, -0.56],
  [-0.1, -0.72],
  [0.08, -0.86],
  [-0.02, -1],
] as const;
/** Share of the bolt's length, from the top, over which it fades in (and towards its foot, out). // TUNE: */
const BOLT_EMERGE = 0.2;
/** The pool of light on the ground at the bolt's foot: radius (bolt lengths) and alpha against the halo's. // TUNE: */
const BOLT_POOL = { radius: 0.6, alpha: 0.8 };
const BOLT_SPRITE = WEATHER_LOOK.storm.bolts.sprite;
const BOLT_FORK = [
  [0.06, -0.27],
  [0.2, -0.4],
  [0.16, -0.5],
  [0.3, -0.62],
] as const;

/**
 * A lightning bolt in the x-y plane, hanging from y = 0 to -1: a jagged white
 * core `width` wide with a fork, inside a soft halo ribbon `haloWidth` across
 * (`halo` colour at its middle line, nothing at its edges), a fainter wider
 * glow, two soft round glows, and a soft pool of light on the ground at its
 * foot. Vertex colours
 * carry both, so it is one mesh and one draw call, meant to be added onto
 * what is behind (additive), so it glows on the dark clouds.
 */
export function buildBolt(
  scene: Scene,
  width: number,
  haloWidth: number,
  halo: readonly [number, number, number, number],
): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // One ribbon along `path`: `across` vertices per point (offsets and colours).
  const ribbon = (
    path: readonly (readonly [number, number])[],
    offsets: readonly number[],
    rgba: readonly (readonly [number, number, number, number])[],
    taper: number,
  ): void => {
    const base = positions.length / 3;
    const across = offsets.length;
    path.forEach(([x, y], k) => {
      const narrow = 1 - (taper * k) / Math.max(1, path.length - 1);
      // The top fades in: the bolt comes out of the cloud's belly.
      const emerge = Math.min(1, -y / BOLT_EMERGE, (1 + y) / BOLT_EMERGE + 0.25);
      offsets.forEach((o, m) => {
        positions.push(x + o * narrow, y, 0);
        const c = rgba[m] ?? [1, 1, 1, 1];
        colors.push(c[0], c[1], c[2], c[3] * emerge);
      });
    });
    for (let k = 0; k < path.length - 1; k++) {
      for (let m = 0; m < across - 1; m++) {
        const a = base + k * across + m;
        const b = a + across;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  };
  const clear = [halo[0], halo[1], halo[2], 0] as const;
  const glow = [halo[0], halo[1], halo[2], halo[3]] as const;
  const white = [1, 1, 1, 1] as const;
  const h = haloWidth / 2;
  const w = width / 2;
  // A wide faint outer glow, the halo, then the core.
  const outer = [halo[0], halo[1], halo[2], halo[3] * 0.25] as const;
  ribbon(BOLT_PATH, [-h * 2.2, 0, h * 2.2], [clear, outer, clear], 0.2);
  ribbon(BOLT_PATH, [-h, 0, h], [clear, glow, clear], 0.3);
  ribbon(BOLT_FORK, [-h * 0.6, 0, h * 0.6], [clear, glow, clear], 0.5);
  // Soft round glows (a disc of light facing the camera): one round the
  // bolt's middle and one where it leaves the belly, lighting the cloud from
  // inside. In the mesh itself, so the low tier (no GlowLayer) glows too.
  const sprite = (cy: number, radius: number, alpha: number): void => {
    const mid = positions.length / 3;
    positions.push(0, cy, 0);
    colors.push(halo[0], halo[1], halo[2], halo[3] * alpha);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, cy + Math.sin(a) * radius, 0);
      colors.push(halo[0], halo[1], halo[2], 0);
      indices.push(mid, mid + 1 + i, mid + 1 + ((i + 1) % 16));
    }
  };
  sprite(-0.45, BOLT_SPRITE.radius, BOLT_SPRITE.alpha);
  sprite(-0.04, BOLT_SPRITE.belly, BOLT_SPRITE.bellyAlpha);
  ribbon(BOLT_PATH, [-w, w], [white, white], 0.5);
  ribbon(BOLT_FORK, [-w * 0.7, w * 0.7], [white, white], 0.7);
  // The flash on the ground: a soft flat pool of light round the bolt's foot.
  const pool = positions.length / 3;
  positions.push(BOLT_PATH[BOLT_PATH.length - 1]?.[0] ?? 0, -1, 0);
  colors.push(halo[0], halo[1], halo[2], halo[3] * BOLT_POOL.alpha);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    positions.push(
      (BOLT_PATH[BOLT_PATH.length - 1]?.[0] ?? 0) + Math.cos(a) * BOLT_POOL.radius,
      -1,
      Math.sin(a) * BOLT_POOL.radius,
    );
    colors.push(halo[0], halo[1], halo[2], 0);
    indices.push(pool, pool + 1 + i, pool + 1 + ((i + 1) % 16));
  }
  const mesh = new Mesh('weather-bolt', scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh, false);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}
