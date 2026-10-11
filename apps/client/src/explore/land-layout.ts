import type { WorldPoint } from '@heartpatch/shared';
import { seededRandom, type Collider } from './explore-world.js';
import type { LandGrowth } from './land-config.js';
import { hexReach, softNoise, type LandField } from './land-shape.js';

// Where everything grows on the explore land (#335 art reset), pure and
// seeded from the tile, so every device sees the same meadow and it's
// unit-tested. World units. Inside the tile only things you walk through
// grow (grass, flowers, pebbles), clear of the spots; bushes make a soft
// hedge along the tile's edge; trees, rocks and logs stand outside it, never
// between the camera and the tile (the camera looks towards +z).

export type FlowerKind = 'daisy' | 'tulip' | 'bell';
export type TreeKind = 'oak' | 'pine' | 'birch';

/** One thing growing: where, which way it turns, and its size. */
export interface Growth {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
}

/** A soft shade painted on the ground under something (baked AO), world units. */
export interface Shade {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  /** 0–1. */
  readonly strength: number;
  /** A cast shadow is longer along the sun's direction on the ground (a unit vector), this many times. */
  readonly along?: { readonly x: number; readonly z: number };
  readonly stretch?: number;
}

/** A drifting mote's home: where it hovers, and its drift (`terrainDrift`: mode, phase, range, speed). */
export interface MoteHome {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
  readonly phase: number;
}

export interface LandLayout {
  readonly tufts: readonly Growth[];
  readonly flowers: Readonly<Record<FlowerKind, readonly Growth[]>>;
  readonly bushes: readonly Growth[];
  readonly berryBushes: readonly Growth[];
  readonly trees: Readonly<Record<TreeKind, readonly Growth[]>>;
  /** Trees far out on the hills (a lighter mesh, no shadow). */
  readonly farTrees: readonly Growth[];
  readonly rocks: readonly Growth[];
  readonly logs: readonly Growth[];
  readonly mushrooms: readonly Growth[];
  readonly pebbles: readonly Growth[];
  readonly lamps: readonly Growth[];
  readonly shades: readonly Shade[];
  readonly butterflies: readonly MoteHome[];
  readonly pollen: readonly MoteHome[];
  readonly fireflies: readonly MoteHome[];
}

export interface LayoutInput {
  readonly growth: LandGrowth;
  readonly land: LandField;
  readonly seed: number;
  /** The tile's size: middle to corner, world units. */
  readonly size: number;
  /** The spots' and buildings' colliders, world units. */
  readonly colliders: readonly Collider[];
  /** Where the Keeper starts, world units (kept clear). */
  readonly start: WorldPoint;
  /**
   * Painted shadows (#335): where the sun throws a shadow, as a ground
   * offset per unit of height, and how dark the cast and contact shades are.
   */
  readonly sun: { readonly x: number; readonly z: number };
  readonly shadow: { readonly cast: number; readonly contact: number; readonly length: number };
}

/** Tufts grow out to this far from the middle, world units. */
const GRASS_REACH = 13; // TUNE
/** Flowers grow out to this far. */
const FLOWER_REACH = 12; // TUNE
/** Trees and rocks never stand in front of the tile (towards the camera) within this half-width, world units. */
const FRONT_CLEAR = 9; // TUNE
/** Clearance round a spot for grass and flowers, world units. */
const SPOT_CLEAR = 0.12; // TUNE
/** The far trees' ring, world units from the middle. */
const FAR = { from: 13, to: 40 } as const; // TUNE

/** A stable shuffle, so the first n of a list (a lower tier's share) spread evenly. */
function shuffled<T>(list: T[], rand: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = list[i] as T;
    list[i] = list[j] as T;
    list[j] = a;
  }
  return list;
}

export function landLayout(input: LayoutInput): LandLayout {
  const { growth, land, seed, size, colliders, start, sun, shadow } = input;
  const rand = seededRandom(seed ^ 0x5a17);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const reach = (x: number, z: number) => hexReach({ x, z }, size);
  const inSpot = (x: number, z: number, clear: number) =>
    colliders.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + clear) ** 2);
  const nearStart = (x: number, z: number, r: number) =>
    (x - start.x) ** 2 + (z - start.z) ** 2 < r * r;
  /** In front of the tile, between it and the camera: only low things grow there. */
  const inFront = (x: number, z: number) => z < -size * 0.55 && Math.abs(x) < FRONT_CLEAR;
  const at = (x: number, z: number, scale: number): Growth => ({
    x,
    z,
    yaw: rand() * Math.PI * 2,
    scale,
  });
  const shades: Shade[] = [];
  const sunLength = Math.hypot(sun.x, sun.z) || 1;
  const along = { x: sun.x / sunLength, z: sun.z / sunLength };
  /**
   * Something `height` tall and `r` round at (x, z): a soft contact shade
   * right under it, and its shadow cast along the sun, longer the taller it is.
   */
  const shade = (x: number, z: number, r: number, height: number) => {
    shades.push({ x, z, r: r * 0.9, strength: shadow.contact });
    const reach = height * shadow.length;
    shades.push({
      x: x + sun.x * reach,
      z: z + sun.z * reach,
      r,
      strength: shadow.cast,
      along,
      stretch: 1 + (reach * sunLength) / (2 * r),
    });
  };
  // Every spot and building sits in its own shade.
  for (const c of colliders) shade(c.x, c.z, c.r * 1.4, 1);

  // Grass: evenly random, thinner on the path, none on a spot.
  const tufts: Growth[] = [];
  const hexArea = 3 * Math.sqrt(3) * 0.5 * size * size;
  const ringArea = Math.PI * GRASS_REACH ** 2 - hexArea;
  const want = growth.tufts.inside * hexArea + growth.tufts.outside * ringArea;
  for (let tries = 0; tufts.length < want && tries < want * 4; tries++) {
    const x = between(-GRASS_REACH, GRASS_REACH);
    const z = between(-GRASS_REACH, GRASS_REACH);
    const inside = reach(x, z) < 1;
    if (Math.hypot(x, z) > GRASS_REACH) continue;
    // Outside the tile it's sparser (rejection keeps the inside density exact).
    if (!inside && rand() > growth.tufts.outside / growth.tufts.inside) continue;
    if (land.pathMask(x, z) > 0.2 && rand() > 0.08) continue;
    if (inSpot(x, z, 0.05)) continue;
    // Clumps: grass is thicker where the noise is high.
    if (softNoise(x * 0.35, z * 0.35, seed + 3) < -0.45 && rand() < 0.6) continue;
    tufts.push(at(x, z, between(0.75, 1.3)));
  }

  // Flowers: patches (a noise threshold), three kinds by another noise.
  const flowers: Record<FlowerKind, Growth[]> = { daisy: [], tulip: [], bell: [] };
  const flowerArea = Math.PI * FLOWER_REACH ** 2 - hexArea;
  const flowerWant = growth.flowers.inside * hexArea + growth.flowers.outside * flowerArea;
  let flowerCount = 0;
  for (let tries = 0; flowerCount < flowerWant && tries < flowerWant * 12; tries++) {
    const x = between(-FLOWER_REACH, FLOWER_REACH);
    const z = between(-FLOWER_REACH, FLOWER_REACH);
    if (Math.hypot(x, z) > FLOWER_REACH) continue;
    const inside = reach(x, z) < 1;
    if (inside && rand() > growth.flowers.inside / growth.flowers.outside) continue;
    if (softNoise(x * 0.28, z * 0.28, seed + 5) < 0.05) continue;
    if (land.pathMask(x, z) > 0) continue;
    if (inSpot(x, z, SPOT_CLEAR) || nearStart(x, z, 0.5)) continue;
    const pick = softNoise(x * 0.12, z * 0.12, seed + 9);
    const kind: FlowerKind = pick < -0.35 ? 'tulip' : pick < 0.25 ? 'daisy' : 'bell';
    flowers[kind].push(at(x, z, between(0.8, 1.25)));
    flowerCount++;
  }

  // The hedge along the tile's edge: bushes just outside each side, a gap where the path leaves.
  const bushes: Growth[] = [];
  const berryBushes: Growth[] = [];
  const hedge = (x: number, z: number, scale: number) => {
    (rand() < 0.25 ? berryBushes : bushes).push(at(x, z, scale));
    shade(x, z, 0.75 * scale, 0.7 * scale);
  };
  for (let i = 0; i < growth.bushes.edge; i++) {
    const angle = ((i + rand() * 0.6) / growth.bushes.edge) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    // Out along the ray to just past the edge.
    const toEdge = 1 / Math.max(1e-6, reach(dx, dz));
    const out = toEdge * between(1.06, 1.2);
    const x = dx * out;
    const z = dz * out;
    if (land.pathMask(x, z, 0.1) > 0 || Math.abs(x - land.pathX(z)) < 1.1) continue;
    hedge(x, z, between(0.8, 1.2));
  }
  for (let tries = 0, n = 0; n < growth.bushes.outside && tries < 400; tries++) {
    const angle = rand() * Math.PI * 2;
    const out = between(size * 1.25, size * 2.3);
    const x = Math.cos(angle) * out;
    const z = Math.sin(angle) * out;
    if (Math.abs(x - land.pathX(z)) < 1.2) continue;
    hedge(x, z, between(0.9, 1.5));
    n++;
  }

  // Trees round the tile: never in front, never on the path, not too close to each other.
  const trees: Record<TreeKind, Growth[]> = { oak: [], pine: [], birch: [] };
  const placed: WorldPoint[] = [];
  for (let tries = 0, n = 0; n < growth.trees.near && tries < 800; tries++) {
    const angle = rand() * Math.PI * 2;
    const out = between(size * 1.2, size * 2);
    const x = Math.cos(angle) * out;
    const z = Math.sin(angle) * out;
    if (inFront(x, z) || reach(x, z) < 1.12) continue;
    if (Math.abs(x - land.pathX(z)) < 1.6) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.4 ** 2)) continue;
    placed.push({ x, z });
    const roll = rand();
    const kind: TreeKind = roll < 0.5 ? 'oak' : roll < 0.8 ? 'birch' : 'pine';
    const scale = between(0.85, 1.25);
    trees[kind].push(at(x, z, scale));
    shade(x, z, 1.25 * scale, 3 * scale);
  }
  // Far trees: groves on the hills (where the noise is high).
  const farTrees: Growth[] = [];
  for (
    let tries = 0;
    farTrees.length < growth.trees.far && tries < growth.trees.far * 30;
    tries++
  ) {
    const angle = rand() * Math.PI * 2;
    const out = between(FAR.from, FAR.to);
    const x = Math.cos(angle) * out;
    const z = Math.sin(angle) * out;
    if (z < -size * 1.2) continue;
    if (softNoise(x * 0.09, z * 0.09, seed + 11) < 0.05) continue;
    if (Math.abs(x - land.pathX(z)) < 2) continue;
    farTrees.push(at(x, z, between(0.9, 1.6)));
  }

  // Rocks, logs and mushrooms: outside the tile, beside the hedge.
  const outside = (
    count: number,
    from: number,
    to: number,
    clearFront: boolean,
    r: number,
    h: number,
  ) => {
    const out: Growth[] = [];
    for (let tries = 0; out.length < count && tries < count * 60; tries++) {
      const angle = rand() * Math.PI * 2;
      const d = between(size * from, size * to);
      const x = Math.cos(angle) * d;
      const z = Math.sin(angle) * d;
      if (reach(x, z) < 1.05 || (clearFront && inFront(x, z))) continue;
      if (Math.abs(x - land.pathX(z)) < 1) continue;
      const scale = between(0.8, 1.3);
      out.push(at(x, z, scale));
      if (h > 0) shade(x, z, r * scale, h * scale);
    }
    return out;
  };
  const rocks = outside(growth.rocks, 1.05, 1.9, false, 0.65, 0.5);
  const logs = outside(growth.logs, 1.1, 1.8, true, 0.6, 0.4);
  const mushrooms = outside(growth.mushrooms, 1.0, 1.6, false, 0, 0);

  // Pebbles inside, off the spots; they're walked over.
  const pebbles: Growth[] = [];
  for (let tries = 0; pebbles.length < growth.pebbles && tries < growth.pebbles * 20; tries++) {
    const x = between(-size, size);
    const z = between(-size, size);
    if (reach(x, z) > 0.95 || inSpot(x, z, 0.1)) continue;
    pebbles.push(at(x, z, between(0.7, 1.2)));
  }

  // Lanterns beside the path, where it leaves the tile (front and back) and further back.
  const lamps: Growth[] = [];
  const side = (rand() < 0.5 ? -1 : 1) * (0.9 * 0.5 + 0.45);
  for (const z of [size * 0.98, -size * 1.02, size * 1.6].slice(0, growth.lamps)) {
    const x = land.pathX(z) + side * (lamps.length % 2 === 0 ? 1 : -1);
    lamps.push({ x, z, yaw: 0, scale: 1 });
    shade(x, z, 0.22, 1.6);
  }

  // Life: butterflies over the flowers, pollen over the grass, fireflies round the edge.
  const flowerList = [...flowers.daisy, ...flowers.tulip, ...flowers.bell].filter(
    (f) => reach(f.x, f.z) < 1.5,
  );
  const home = (x: number, z: number, lift: [number, number], s: [number, number]): MoteHome => ({
    x,
    y: land.height(x, z) + between(lift[0], lift[1]),
    z,
    size: between(s[0], s[1]),
    phase: rand() * Math.PI * 2,
  });
  const butterflies: MoteHome[] = [];
  for (let i = 0; i < growth.butterflies && flowerList.length > 0; i++) {
    const f = flowerList[Math.floor(rand() * flowerList.length)] as Growth;
    butterflies.push(home(f.x, f.z, [0.45, 0.9], [0.9, 1.2]));
  }
  const scatter = (count: number, spread: number, lift: [number, number], s: [number, number]) =>
    Array.from({ length: count }, () => {
      const angle = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * spread;
      return home(Math.cos(angle) * d, Math.sin(angle) * d, lift, s);
    });
  const pollen = scatter(growth.pollen, size * 1.2, [0.3, 1.4], [0.03, 0.05]);
  const fireflies = scatter(growth.fireflies, size * 1.5, [0.25, 1.3], [0.09, 0.13]);

  return {
    tufts: shuffled(tufts, rand),
    flowers: {
      daisy: shuffled(flowers.daisy, rand),
      tulip: shuffled(flowers.tulip, rand),
      bell: shuffled(flowers.bell, rand),
    },
    bushes,
    berryBushes,
    trees,
    farTrees,
    rocks,
    logs,
    mushrooms,
    pebbles,
    lamps,
    shades,
    butterflies,
    pollen,
    fireflies,
  };
}
