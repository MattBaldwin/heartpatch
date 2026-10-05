import type { BattleTimeOfDay } from '@heartpatch/shared';
import type { PropKind } from '../map/map-config.js';

/**
 * Lantern Hour's stage (owner decision 2026-10-05): every battle plays on a
 * diorama of the terrain it happens on, at the patch's time of day, lit by a
 * warm golden-hour key light from behind the other side with a violet fill,
 * haze and far hills for depth, and drifting motes. The ground and props
 * come from the map's own terrain looks and prop builders (`TERRAIN_LOOKS`,
 * `buildProp`); this file only says how a terrain is composed into an arena
 * and how each time of day looks. Every number is a first guess for the
 * playtest.
 */

/** A group of props on a ring around the fight. */
export interface ArenaPropGroup {
  readonly kind: PropKind;
  readonly count: number;
  /** Distance from the arena's middle, world units: [nearest, furthest]. */
  readonly ring: readonly [number, number];
  /** Size against the map's prop (a map tree is about 0.5 tall; a squishy here about 3): [smallest, biggest]. */
  readonly scale: readonly [number, number];
  /** Also in front of the fighters (small dressing only). Default: behind and to the sides. */
  readonly front?: boolean;
}

export interface ArenaSpec {
  /** Ground colour when it differs from the map tile's (a lake's shore is sand, not water). */
  readonly ground?: string;
  readonly props: readonly ArenaPropGroup[];
  /** A pool behind the fighters (the lake), in this colour; null for none. */
  readonly water: string | null;
  /** A hint of the terrain in the sky's haze (mixed into the horizon by `hazeMix`). */
  readonly haze: string;
  /** The far hills' colour (soft silhouettes behind the treeline). */
  readonly hills: string;
}

const ring = (near: number, far: number): readonly [number, number] => [near, far];

/** Keyed by terrain id (packages/shared/src/data/terrains.ts); `arenaPlan` falls back to `FALLBACK_ARENA`. */
export const ARENA_SPECS: Readonly<Record<string, ArenaSpec>> = {
  meadow: {
    props: [
      { kind: 'tree', count: 14, ring: ring(12, 18), scale: [9.3, 13.6] }, // TUNE
      { kind: 'tall-tree', count: 6, ring: ring(14, 19), scale: [11, 15.3] }, // TUNE
      { kind: 'bush', count: 9, ring: ring(7, 13), scale: [4, 6] }, // TUNE
      { kind: 'rock', count: 3, ring: ring(7, 11), scale: [3, 4.5] }, // TUNE
      { kind: 'flowers', count: 22, ring: ring(4.6, 13), scale: [2.4, 3.2], front: true }, // TUNE
      { kind: 'grass', count: 26, ring: ring(4.2, 14), scale: [2.4, 3.4], front: true }, // TUNE
      { kind: 'mushroom', count: 4, ring: ring(5, 9), scale: [3.5, 4.5], front: true }, // TUNE
    ],
    water: null,
    haze: '#d9f2c4',
    hills: '#7fb98a',
  },
  forest: {
    props: [
      { kind: 'tree', count: 16, ring: ring(8.5, 16), scale: [9.3, 13.6] }, // TUNE
      { kind: 'pine', count: 16, ring: ring(12, 19), scale: [11.9, 17] }, // TUNE: a treeline behind
      { kind: 'tall-tree', count: 4, ring: ring(10, 15), scale: [10.2, 13.6] }, // TUNE
      { kind: 'stump', count: 2, ring: ring(6, 9), scale: [4, 5] }, // TUNE
      { kind: 'mushroom', count: 8, ring: ring(5, 9), scale: [4, 5.5], front: true }, // TUNE
      { kind: 'grass', count: 18, ring: ring(4.2, 12), scale: [2.4, 3.2], front: true }, // TUNE
    ],
    water: null,
    haze: '#bfe6c8',
    hills: '#5e9a78',
  },
  'old-forest': {
    props: [
      { kind: 'old-tree', count: 16, ring: ring(8, 15), scale: [9.3, 13.6] }, // TUNE
      { kind: 'old-tree', count: 10, ring: ring(14, 19), scale: [13.6, 20.4] }, // TUNE
      { kind: 'log', count: 2, ring: ring(6, 9), scale: [4, 5] }, // TUNE
      { kind: 'mushroom', count: 12, ring: ring(4.6, 10), scale: [4.5, 6.5], front: true }, // TUNE
      { kind: 'rock', count: 3, ring: ring(6, 10), scale: [3, 4] }, // TUNE
    ],
    water: null,
    haze: '#a9d4b8',
    hills: '#4b7f68',
  },
  hills: {
    props: [
      { kind: 'rock', count: 9, ring: ring(6, 13), scale: [3.5, 6] }, // TUNE
      { kind: 'stones', count: 5, ring: ring(5, 10), scale: [4, 5], front: true }, // TUNE
      { kind: 'bush', count: 4, ring: ring(7, 12), scale: [4, 5] }, // TUNE
      { kind: 'tree', count: 7, ring: ring(13, 18), scale: [8.5, 11.9] }, // TUNE
      { kind: 'grass', count: 16, ring: ring(4.2, 12), scale: [2.4, 3.2], front: true }, // TUNE
      { kind: 'flowers', count: 8, ring: ring(5, 11), scale: [2.4, 3], front: true }, // TUNE
    ],
    water: null,
    haze: '#f3e4c2',
    hills: '#c9ad7a',
  },
  mountains: {
    props: [
      { kind: 'snow-peak', count: 5, ring: ring(12.5, 17), scale: [15.3, 20.4] }, // TUNE
      { kind: 'peak', count: 3, ring: ring(11, 14), scale: [11.9, 15.3] }, // TUNE
      { kind: 'rock', count: 9, ring: ring(6, 12), scale: [3.5, 6] }, // TUNE
      { kind: 'pine', count: 4, ring: ring(9, 13), scale: [8.5, 11] }, // TUNE
    ],
    water: null,
    haze: '#ddd6ec',
    hills: '#9d93bd',
  },
  lake: {
    ground: '#f2e2b8', // TUNE: a sandy shore; the lake itself is the water behind
    props: [
      { kind: 'reeds', count: 18, ring: ring(6.5, 10), scale: [3, 4.2] }, // TUNE
      { kind: 'rock', count: 5, ring: ring(6, 10), scale: [3, 4.5] }, // TUNE
      { kind: 'stones', count: 4, ring: ring(4.8, 8), scale: [4, 5], front: true }, // TUNE
      { kind: 'tree', count: 9, ring: ring(14, 19), scale: [8.5, 11.9] }, // TUNE: the far shore
      { kind: 'lily-pad', count: 8, ring: ring(9, 14), scale: [4, 6] }, // TUNE
    ],
    water: '#9fd6f5', // TUNE: the map's lake colour
    haze: '#d6effa',
    hills: '#7fa9b8',
  },
  'pumpkin-fields': {
    props: [
      { kind: 'pumpkin', count: 20, ring: ring(5.5, 14), scale: [3.5, 6] }, // TUNE
      { kind: 'jack-o-lantern', count: 5, ring: ring(6, 12), scale: [4, 5.5] }, // TUNE
      { kind: 'hay-bale', count: 3, ring: ring(8, 13), scale: [3.5, 4.5] }, // TUNE
      { kind: 'tree', count: 9, ring: ring(13.5, 19), scale: [8.5, 12.8] }, // TUNE
      { kind: 'grass', count: 16, ring: ring(4.2, 12), scale: [2.4, 3.2], front: true }, // TUNE
    ],
    water: null,
    haze: '#ffe2b0',
    hills: '#b58a6a',
  },
  'junipers-gap': {
    props: [
      { kind: 'crystal', count: 7, ring: ring(6, 12), scale: [4.5, 6.5] }, // TUNE
      { kind: 'flowers', count: 22, ring: ring(4.6, 12), scale: [2.4, 3.2], front: true }, // TUNE
      { kind: 'rock', count: 4, ring: ring(7, 12), scale: [3, 4] }, // TUNE
      { kind: 'tree', count: 4, ring: ring(13, 17), scale: [8.5, 11.9] }, // TUNE
    ],
    water: null,
    haze: '#f1dcff',
    hills: '#a98bd0',
  },
};

/** The arena for a terrain this client doesn't know yet. */
export const FALLBACK_ARENA = 'meadow';

/** Sizes of the diorama, world units. */
export const ARENA_STAGE = {
  /** Radius of the ground disc. */
  groundRadius: 20, // TUNE
  /** Thickness of the ground slab (its edge shows: it's a little diorama). */
  groundDepth: 1.1, // TUNE
  /** Props stay this far from the arena's middle (the fight between the fighters). */
  clearRadius: 4.2, // TUNE
  /** And this far from where each fighter stands (its width, a knockback, a dodge). */
  fighterClear: 2.9, // TUNE
  /** Big props stand behind the fighters and to the sides: angle off the camera's line, radians. */
  propArc: 2.0, // TUNE: about 115° each side
  /** Nothing big between the camera and the fight: a box in front of the fighters stays empty. */
  cameraLane: { z: -2, halfWidth: 7 }, // TUNE
  /** Where the lake's water starts behind the fighters (+z, away from the camera). */
  waterFrom: 5.5, // TUNE
  /** Sky dome radius (well inside the camera's far plane). */
  skyRadius: 95, // TUNE
  /** Far hills: how many, how far, their size. */
  hills: { count: 9, distance: [34, 48], width: [14, 26], height: [5, 11] }, // TUNE
  /** Vinyl clouds: how far out, how high, their size. */
  clouds: { distance: [0.7, 0.9], height: [14, 36], size: [1.2, 2.8] }, // TUNE: distance × skyRadius
  /** Stars on a night sky. */
  stars: 80, // TUNE
  /** The ground's mottling (value noise) and how dark it gets towards the rim. */
  ground: { rimDarken: 0.26, mottle: 0.22 }, // TUNE
  /** How much of the terrain's haze colour tints the horizon. */
  hazeMix: 0.35, // TUNE
  /** On the low quality tier, scatter this share of the props (and draw no shadow map). */
  lowTier: { props: 0.6 }, // TUNE
  /** The fighters' shadow map (the key light's): size and softness. */
  shadowMap: { size: 1024, darkness: 0.35, frustum: 26 }, // TUNE
} as const;

/** A directional light: where it travels, its sRGB colour and strength. */
export interface ArenaLight {
  readonly dir: readonly [number, number, number];
  readonly color: string;
  readonly intensity: number;
}

/**
 * How a time of day looks on the stage: the lights (a warm key from behind
 * the other side, a violet fill), the sky dome, haze, motes, and the image
 * processing. Night is a friendly deep blue (style guide: spooky is cozy,
 * never scary), bright enough that every squishy reads.
 */
export interface ArenaMood {
  readonly key: ArenaLight;
  readonly fill: ArenaLight;
  /** The sky light (IBL) strength. */
  readonly environment: number;
  /** Contact shadows stretched along the key light (long golden-hour shadows), 1 = round. */
  readonly shadowStretch: number;
  readonly exposure: number;
  readonly contrast: number;
  readonly vignette: number;
  readonly sky: {
    readonly zenith: string;
    readonly horizon: string;
    /** Below the horizon (the land past the diorama's edge). */
    readonly below: string;
    /** A warm glow around the sun's azimuth near the horizon (0 off). */
    readonly sunGlow: number;
    readonly sunColor: string;
    /** A sun (or moon) disc in the sky. */
    readonly sunDisc: boolean;
    readonly clouds: number;
    readonly cloudColor: string;
  };
  /** Linear fog start and end (depth haze). */
  readonly fog: readonly [number, number];
  /** Drifting motes (pollen by day, fireflies by night): how many and their colour. */
  readonly motes: { readonly count: number; readonly color: string };
  /** A moon and stars. */
  readonly night: boolean;
  /** Ground, props and water tinted towards this (dusk's warm, night's blue), 0–1 by `tint`. */
  readonly tintColor: string;
  readonly tint: number;
}

export const ARENA_MOODS: Readonly<Record<BattleTimeOfDay, ArenaMood>> = {
  day: {
    key: { dir: [0.35, -0.6, -0.75], color: '#ffe3b8', intensity: 2.0 }, // TUNE
    fill: { dir: [-0.6, -0.6, 0.5], color: '#b8c6ff', intensity: 0.55 }, // TUNE
    environment: 0.85, // TUNE
    shadowStretch: 1.7, // TUNE
    exposure: 1.06, // TUNE
    contrast: 1.14, // TUNE
    vignette: 1.1, // TUNE
    sky: {
      zenith: '#7fb2ec', // TUNE
      horizon: '#ffe9c4', // TUNE
      below: '#c9ad9f', // TUNE
      sunGlow: 0.55, // TUNE
      sunColor: '#fff2c8', // TUNE
      sunDisc: true,
      clouds: 4, // TUNE
      cloudColor: '#fff6ec', // TUNE
    },
    fog: [28, 90], // TUNE
    motes: { count: 40, color: '#fff6cf' }, // TUNE
    night: false,
    tintColor: '#ffffff',
    tint: 0,
  },
  dusk: {
    key: { dir: [0.5, -0.4, -0.75], color: '#ffb070', intensity: 2.1 }, // TUNE
    fill: { dir: [-0.6, -0.6, 0.5], color: '#9f8cff', intensity: 0.7 }, // TUNE
    environment: 0.6, // TUNE
    shadowStretch: 2.2, // TUNE
    exposure: 1.04, // TUNE
    contrast: 1.18, // TUNE
    vignette: 1.3, // TUNE
    sky: {
      zenith: '#5d5aa8', // TUNE
      horizon: '#ffb27c', // TUNE
      below: '#6e4f6e', // TUNE
      sunGlow: 1.0, // TUNE
      sunColor: '#ffd08a', // TUNE
      sunDisc: true,
      clouds: 4, // TUNE
      cloudColor: '#ffc9b8', // TUNE
    },
    fog: [25, 85], // TUNE
    motes: { count: 60, color: '#ffe6b0' }, // TUNE
    night: false,
    tintColor: '#ffb08a',
    tint: 0.16, // TUNE
  },
  night: {
    key: { dir: [0.4, -0.6, -0.7], color: '#ffc38a', intensity: 1.4 }, // TUNE: a lantern's warmth
    fill: { dir: [-0.6, -0.6, 0.5], color: '#7d86ff', intensity: 0.8 }, // TUNE
    environment: 0.4, // TUNE
    shadowStretch: 1.8, // TUNE
    exposure: 1.1, // TUNE
    contrast: 1.18, // TUNE
    vignette: 1.5, // TUNE
    sky: {
      zenith: '#171a4a', // TUNE
      horizon: '#4a4a96', // TUNE
      below: '#242246', // TUNE
      sunGlow: 0.4, // TUNE
      sunColor: '#ffe8b8', // TUNE
      sunDisc: true,
      clouds: 3, // TUNE
      cloudColor: '#5e5a9a', // TUNE
    },
    fog: [25, 85], // TUNE
    motes: { count: 90, color: '#f4ffa8' }, // TUNE: fireflies
    night: true,
    tintColor: '#6f7fd6',
    tint: 0.3, // TUNE
  },
};
