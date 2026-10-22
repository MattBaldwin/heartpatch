import { BIG_CHEST_KIND, isBigChest, type ExploreTileResponse } from '@heartpatch/shared';
import type { LandOptions } from '../explore/explore-land.js';
import type { LandLook } from '../explore/land-config.js';
import type { ExtrasContext, Growth } from '../explore/land-layout.js';
import type { SpotShape } from '../explore/trail-kit.js';
import type { Scene } from '@babylonjs/core/scene';
import {
  buildBigChest,
  buildCandleFlames,
  buildCandles,
  buildDaylight,
  buildFlagstone,
  buildFlame,
  buildSconce,
  buildSmallChest,
  buildStairs,
  buildWallBay,
  buildWallSide,
} from './cellar-kit.js';

// The hidden cellar's look (#306, owner decision of 2026-10-22): an ancient
// stone vault under a Hollow's square, unmistakably not the hills cave.
// Warm grey flagstones underfoot, a back wall of big mossy blocks with
// arched alcoves and pillars whose ribs spring up into the vaulted dark,
// candles in sconces and on the floor, a stair back up to the daylight, and
// a row of chests along the back with the big one in the middle. Built on
// the explore land kit: every layer is one thin-instanced draw call.

/** The explore look a cellar is shown in (client only: the server's view says `hills`). */
export const CELLAR_TERRAIN = 'cellar';
/** A small chest's spot kind as the cellar is shown (the server's kinds only pick its finds). */
export const CHEST_KIND = 'chest';

/** Is this spot one of the cellar's chests (a small or the big one)? */
export const isChest = (spot: { readonly kind: string }): boolean =>
  spot.kind === CHEST_KIND || spot.kind === BIG_CHEST_KIND;

/**
 * The cellar's view as the explore scene draws it: the vault's look, and
 * every small chest one kind (the server's kinds pick its finds, not its
 * shape). Indices and positions stay the server's, so a search names the
 * same chest.
 */
export function cellarShown(view: ExploreTileResponse): ExploreTileResponse {
  return {
    ...view,
    terrain: CELLAR_TERRAIN,
    spots: view.spots.map((s) => (isBigChest(s) ? s : { ...s, kind: CHEST_KIND })),
  };
}

/** The vault's floor and air on the land kit: flat warm stone, no growth, no sky. */
export const CELLAR_LOOK: LandLook = {
  palette: {
    grass: ['#8a847e', '#97908a', '#a39c94'], // TUNE: warm grey flagstone
    sunny: '#aaa198', // TUNE
    path: '#b0a291', // TUNE: a worn way to the chests
    pathEdge: '#958878', // TUNE
    specks: ['#6f8f5a', '#9a8e84', '#b5a898', '#7fa266'], // TUNE: moss and grit
    shade: '#2e2622', // TUNE
  },
  shape: {
    bumps: { height: 0.03, scale: 0.2 }, // TUNE: a floor, not a field
    ripples: { height: 0.015, scale: 0.8 }, // TUNE
    rises: { count: 0, height: 0, width: 1 }, // TUNE
    edge: 30, // TUNE: the floor runs flat under the walls
    fall: { depth: 0, length: 5 }, // TUNE
    hills: { height: 0, scale: 0.08 }, // TUNE
    path: { width: 1.1, sway: 0.4, bend: 0.3, sink: 0.02 }, // TUNE
  },
  growth: {
    tufts: { inside: 0, outside: 0 },
    flowers: { inside: 0, outside: 0 },
    bushes: { edge: 0, outside: 0 },
    trees: { near: 0, far: 0 },
    rocks: 0,
    logs: 0,
    mushrooms: 0,
    pebbles: 24, // TUNE: grit between the flagstones
    lamps: 0,
    butterflies: 0,
    pollen: 0,
    fireflies: 0,
  },
};

/**
 * Where the room stands, in tile sizes (the tile is 1 from the middle to a
 * corner; +z away from the camera). The chests stand at the server's spots.
 */
export const CELLAR_ROOM = {
  /** The back wall's face, and its bays' width (world units, the kit's bay). */
  back: 1.08, // TUNE
  bay: 4.2,
  /** The side walls, and how far forwards they run. */
  side: 1.5, // TUNE
  sideFrom: -1.6, // TUNE
  /** The stair back up, at the back wall's left end. */
  stairs: { x: -1.16, z: 0.84 }, // TUNE
  /** Candle clusters on the floor. */
  candles: [
    [-0.2, 0.86],
    [0.22, 0.88],
    [-0.98, 0.42],
    [0.98, 0.4],
    [0.62, 0.84],
    [-0.62, 0.84],
  ],
  /** Flagstones underfoot. */
  flagstones: 46, // TUNE
  /** Candlelight's pool on the floor: its colour and strength. */
  glow: { tint: '#ffcf8a', strength: 0.4, sconce: 2.4, candle: 1.6 }, // TUNE
} as const;

/** The candles' and sconces' height (world units): their meshes stand on the floor at 0. */
const at = (x: number, z: number, yaw = 0, scale = 1): Growth => ({ x, z, yaw, scale });

const cellarPlace = (ctx: ExtrasContext): Readonly<Record<string, readonly Growth[]>> => {
  const S = ctx.size;
  const R = CELLAR_ROOM;
  const back = R.back * S;
  const bays: Growth[] = [];
  for (let x = -R.bay * 4; x <= R.bay * 4 + 0.01; x += R.bay) bays.push(at(x, back));
  for (const b of bays) ctx.shade(b.x, b.z - 0.6, 2.6, 3);
  // The sides, facing in, from the back wall forwards.
  const sides: Growth[] = [];
  for (let z = back - R.bay / 2; z >= R.sideFrom * S; z -= R.bay) {
    sides.push(at(-R.side * S, z, Math.PI / 2), at(R.side * S, z, -Math.PI / 2));
  }
  // A sconce on every pillar (each bay's pillar is 2.1 left of its middle).
  const sconces = bays.map((b) => at(b.x - 2.1, back - 0.62));
  for (const s of sconces) {
    ctx.glow(s.x, s.z - 0.4, R.glow.sconce, R.glow.tint, R.glow.strength);
  }
  const candles = R.candles.map(([x, z], i) => at(x * S, z * S, i * 1.7, 0.9 + (i % 3) * 0.12));
  for (const c of candles) {
    ctx.shade(c.x, c.z, 0.5, 0.6);
    ctx.glow(c.x, c.z, R.glow.candle, R.glow.tint, R.glow.strength);
  }
  const stair = at(R.stairs.x * S, R.stairs.z * S);
  const stairs = [stair];
  ctx.shade(stair.x, stair.z, 2.2, 2);
  ctx.glow(stair.x, stair.z - 1.4, 2.4, '#ffe6a8', 0.6);
  // Flagstones: scattered over the floor, never under a chest.
  const flagstones: Growth[] = [];
  for (let tries = 0; flagstones.length < R.flagstones && tries < R.flagstones * 30; tries++) {
    const x = (ctx.rand() * 2 - 1) * S * 1.4;
    const z = -S * 1.4 + ctx.rand() * (back + S * 1.4 - 0.8);
    if (ctx.colliders.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r + 0.9) ** 2)) continue;
    if (flagstones.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < 1.9 ** 2)) continue;
    flagstones.push(at(x, z, ctx.rand() * Math.PI, 0.8 + ctx.rand() * 0.45));
  }
  return {
    'wall-bays': bays,
    'wall-sides': sides,
    sconces,
    flames: sconces,
    candles,
    'candle-flames': candles,
    stairs,
    daylight: stairs,
    flagstones,
  };
};

/** The vault's own layers, in the shape `ExploreLand` takes. */
export const CELLAR_EXTRAS: NonNullable<LandOptions['extras']> = {
  place: cellarPlace,
  layers: {
    'wall-bays': { build: buildWallBay },
    'wall-sides': { build: buildWallSide },
    sconces: { build: buildSconce },
    flames: { build: buildFlame, glow: 1.6 }, // TUNE: over 1 blooms
    candles: { build: buildCandles },
    'candle-flames': { build: buildCandleFlames, glow: 1.6 }, // TUNE
    stairs: { build: buildStairs },
    daylight: { build: buildDaylight, glow: 1.2 }, // TUNE
    flagstones: { build: buildFlagstone },
  },
};

/** The chests as cellar spots, by kind. */
export const CELLAR_SPOTS: Readonly<Record<string, (scene: Scene) => SpotShape>> = {
  [CHEST_KIND]: buildSmallChest,
  [BIG_CHEST_KIND]: buildBigChest,
};
