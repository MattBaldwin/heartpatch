import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged } from '../map/map-props.js';
import {
  buildCrystals,
  buildGlowCaps,
  buildGlowMushroomSpot,
  buildNook,
  buildStalagmite,
  buildWallRock,
} from './cave-kit.js';
import { cylinder, shaded, sphere } from './land-kit.js';
import type { ExtrasContext, Growth } from './land-layout.js';
import { buildCairn, buildLookout, buildSnowDrift, type SpotShape } from './trail-kit.js';
import type { LandOptions } from './explore-land.js';

// What the trail and the cave add on top of the meadow's land kit (#335 art
// reset): their own layers through the kit's `extras` hook, and their search
// spots drawn at world size. Placement is pure and seeded (the hook hands it
// a random of its own), so every device sees the same trail and cave.

/** A far mountain: a rounded cone of lavender stone with a snow cap. */
function buildPeak(scene: Scene): Mesh {
  return merged('trail-peaks', [
    shaded(cylinder(scene, 9, 0.5, 10, 10, [0, 4.5, 0]), '#7d74a6', '#bcb3dc', 0, 9),
    shaded(sphere(scene, 3.0, 6, [0, 8.2, 0], [1, 1.1, 1]), '#e9e6f7', '#ffffff', 7, 9.8),
    shaded(cylinder(scene, 6, 0.4, 7, 9, [4.6, 3, 1]), '#857cae', '#c4bce0', 0, 6),
    shaded(sphere(scene, 2.0, 6, [4.6, 5.6, 1], [1, 1.1, 1]), '#e9e6f7', '#ffffff', 4.8, 6.6),
  ]);
}

type Placer = (ctx: ExtrasContext) => Readonly<Record<string, readonly Growth[]>>;

/** `count` places in a ring `from`…`to` tile-sizes out, off the front (towards the camera) and the path. */
function ring(
  ctx: ExtrasContext,
  count: number,
  from: number,
  to: number,
  scale: [number, number],
  keepOffPath = 1,
  frontClear = true,
  /** Bearing range, degrees from +x (90 is straight ahead of the camera, +z). */
  bearing: [number, number] = [0, 360],
): Growth[] {
  const out: Growth[] = [];
  const between = (lo: number, hi: number) => lo + ctx.rand() * (hi - lo);
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const angle = (between(bearing[0], bearing[1]) * Math.PI) / 180;
    const d = between(ctx.size * from, ctx.size * to);
    const x = Math.cos(angle) * d;
    const z = Math.sin(angle) * d;
    // The camera looks towards +z: nothing tall stands between it and the tile.
    if (frontClear && z < -ctx.size * 0.5 && Math.abs(x) < ctx.size * 1.5) continue;
    if (Math.abs(x - ctx.land.pathX(z)) < keepOffPath) continue;
    out.push({ x, z, yaw: ctx.rand() * Math.PI * 2, scale: between(scale[0], scale[1]) });
  }
  return out;
}

const trailPlace: Placer = (ctx) => {
  // Far peaks across the back, where the camera looks, with a few to the sides.
  // Two layers so they read as a range: a near row and a taller one behind.
  const peaks = [
    ...ring(ctx, 5, 3.6, 4.4, [1.6, 2.2], 0, true, [55, 125]),
    ...ring(ctx, 5, 4.8, 5.8, [2.4, 3.2], 0, true, [40, 140]),
    ...ring(ctx, 3, 4.0, 5.0, [1.4, 2.0], 0, true, [15, 165]),
  ];
  for (const p of peaks) ctx.shade(p.x, p.z, 2.5 * p.scale, 6 * p.scale);
  return { peaks };
};

const cavePlace: Placer = (ctx) => {
  // The cave wall: big rounded boulders across the back, fewer round the sides.
  const walls = [
    ...ring(ctx, 11, 1.35, 1.8, [2.4, 3.4], 1.2, true, [35, 145]),
    ...ring(ctx, 9, 1.5, 2.1, [1.8, 2.6], 1.2, true, [0, 180]),
    // A second, taller row behind, so no gap shows the roof's edge.
    ...ring(ctx, 10, 2.1, 2.6, [3.0, 4.2], 0, true, [20, 160]),
  ];
  for (const w of walls) ctx.shade(w.x, w.z, 1.8 * w.scale, 2.4 * w.scale);
  const stalagmites = ring(ctx, 14, 1.2, 1.9, [0.9, 1.5], 1, true, [20, 160]);
  for (const s of stalagmites) ctx.shade(s.x, s.z, 0.6 * s.scale, 1.6 * s.scale);
  const crystals = ring(ctx, 14, 1.05, 1.7, [0.9, 1.5], 1, false, [0, 360]).filter(
    (c) => !ctx.colliders.some((k) => (c.x - k.x) ** 2 + (c.z - k.z) ** 2 < (k.r + 0.3) ** 2),
  );
  const caps = ring(ctx, 10, 1.0, 1.6, [0.9, 1.3], 1, false);
  // A few small clusters inside the tile, so the glow reaches the Keeper's floor.
  const near = ring(ctx, 6, 0.35, 0.95, [0.5, 0.8], 1, false).filter(
    (c) => !ctx.colliders.some((k) => (c.x - k.x) ** 2 + (c.z - k.z) ** 2 < (k.r + 0.6) ** 2),
  );
  crystals.push(...near);
  // Each one lights a soft pool of its own colour on the floor.
  crystals.forEach((c, i) => {
    ctx.glow(c.x, c.z, 2.2 * c.scale, i % 2 ? '#c9a8ff' : '#7fe4f5', 0.6); // TUNE
  });
  for (const c of caps) ctx.glow(c.x, c.z, 1.2 * c.scale, '#9fe8ff', 0.45); // TUNE
  return { 'wall-rocks': walls, stalagmites, crystals, 'glow-caps': caps };
};

/** Each trail or cave terrain's own layers, in the shape `ExploreLand` takes. */
export const BIOME_EXTRAS: Readonly<Record<string, NonNullable<LandOptions['extras']>>> = {
  mountains: { place: trailPlace, layers: { peaks: { build: buildPeak } } },
  hills: {
    place: cavePlace,
    layers: {
      'wall-rocks': { build: buildWallRock },
      stalagmites: { build: buildStalagmite },
      crystals: { build: buildCrystals, glow: 1.3 }, // TUNE: over 1 blooms
      'glow-caps': { build: buildGlowCaps, glow: 1.15 }, // TUNE
    },
  },
};

const SPOTS: Readonly<Record<string, (scene: Scene) => SpotShape>> = {
  ledge: buildLookout,
  'snow-drift': buildSnowDrift,
  cairn: buildCairn,
  cave: buildNook,
  'glow-mushrooms': buildGlowMushroomSpot,
};

/** The trail's and the cave's search spots, drawn in the kit's style; null: not one of theirs. */
export function buildBiomeSpot(scene: Scene, kind: string): SpotShape | null {
  return SPOTS[kind]?.(scene) ?? null;
}
