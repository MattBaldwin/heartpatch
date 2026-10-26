import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { CLOUD_ATTRIBUTE } from './cloud-plugin.js';
import { WEATHER_LOOK } from './weather-config.js';

const { squash, floor, sun, blend } = WEATHER_LOOK.clouds;

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
  const n = positions.length / 3;
  let high: number = floor;
  for (let i = 0; i < n; i++) high = Math.max(high, positions[i * 3 + 1] ?? 0);
  const norm = Math.hypot(...sun) || 1;
  const shade = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const facing =
      ((normals[i * 3] ?? 0) * sun[0] +
        (normals[i * 3 + 1] ?? 0) * sun[1] +
        (normals[i * 3 + 2] ?? 0) * sun[2]) /
      norm;
    shade[i * 4] = Math.min(1, Math.max(0, ((positions[i * 3 + 1] ?? 0) - floor) / (high - floor)));
    shade[i * 4 + 1] = Math.max(0, facing);
  }
  const cloud = new Mesh('weather-clouds', scene);
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
const BOLT_FORK = [
  [0.06, -0.27],
  [0.2, -0.4],
  [0.16, -0.5],
  [0.3, -0.62],
] as const;

/**
 * A lightning bolt in the x-y plane, hanging from y = 0 to -1: a jagged white
 * core `width` wide with a fork, inside a soft halo ribbon `haloWidth` across
 * (`halo` colour at its middle line, nothing at its edges). Vertex colours
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
  ribbon(BOLT_PATH, [-h, 0, h], [clear, glow, clear], 0.3);
  ribbon(BOLT_FORK, [-h * 0.6, 0, h * 0.6], [clear, glow, clear], 0.5);
  ribbon(BOLT_PATH, [-w, w], [white, white], 0.5);
  ribbon(BOLT_FORK, [-w * 0.7, w * 0.7], [white, white], 0.7);
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
