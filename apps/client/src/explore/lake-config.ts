import type { QualityTier } from '../engine/config.js';
import type { LandLook } from './land-config.js';

/**
 * The lake on the meadow's land kit (#335 art reset). A lake is explored
 * underwater with the Snorkel, so the "land" is its sandy bed: the same
 * sculpted, painted, thin-instanced kit as the meadow with a sand palette,
 * seagrass for tufts, boulders and sunken logs, and the lake's own growth
 * (kelp groves, coral, fish, bubbles) in `explore-water.ts`. Every number
 * is a first guess to judge on the playtest devices.
 *
 * The palette keeps the kit's field names: `grass` is the sand in three
 * shades, `path` a swept pale trail, `specks` tiny shells and pearls.
 */
export const LAKE_LOOKS: Readonly<Record<string, LandLook>> = {
  lake: {
    palette: {
      grass: ['#d2a674', '#e2be8c', '#eed3a8'], // TUNE
      sunny: '#ecd9a8', // TUNE
      path: '#f1e0b6', // TUNE
      pathEdge: '#b89a62', // TUNE
      specks: ['#ffffff', '#ffe0ea', '#d9f0ff', '#ffe9a8'], // TUNE
      shade: '#5f8a86', // TUNE
    },
    shape: {
      bumps: { height: 0.2, scale: 0.13 }, // TUNE: sand dunes
      ripples: { height: 0.05, scale: 0.9 }, // TUNE
      rises: { count: 3, height: 0.3, width: 1.8 }, // TUNE
      edge: 7.0, // TUNE: as the meadow's, just past the tile's corners
      fall: { depth: 16, length: 10 }, // TUNE: the far bed sinks into the haze
      hills: { height: 1.2, scale: 0.075 }, // TUNE
      path: { width: 1.0, sway: 1.6, bend: 0.3, sink: 0.03 }, // TUNE
    },
    growth: {
      tufts: { inside: 4, outside: 2.5 }, // TUNE: seagrass
      flowers: { inside: 0, outside: 0 },
      bushes: { edge: 0, outside: 0 }, // coral instead (water-layout.ts)
      trees: { near: 0, far: 0 }, // kelp instead
      rocks: 12, // TUNE
      logs: 3, // TUNE: sunken logs
      mushrooms: 0,
      pebbles: 40, // TUNE
      lamps: 0,
      butterflies: 0,
      pollen: 0,
      fireflies: 0,
    },
  },
};

/** What lives in the water, per lake: counts, sizes and colours. */
export interface WaterLook {
  /** Kelp stalks in the ring round the tile, and in groves out on the far bed. */
  readonly kelp: { readonly near: number; readonly far: number };
  /** Coral clusters along the tile's edge, and scattered further out. */
  readonly coral: { readonly edge: number; readonly outside: number };
  /** Fish circling in the water. */
  readonly fish: number;
  /** Bubbles drifting up across the water, and per bubble spring. */
  readonly bubbles: { readonly ambient: number; readonly perSpring: number };
}

export const WATER_LOOKS_BY_TERRAIN: Readonly<Record<string, WaterLook>> = {
  lake: {
    kelp: { near: 24, far: 40 }, // TUNE
    coral: { edge: 20, outside: 18 }, // TUNE
    fish: 7, // TUNE
    bubbles: { ambient: 22, perSpring: 8 }, // TUNE
  },
};

/** Fish colours (instance colours on one white fish mesh). */
export const FISH_COLORS = ['#ffb36b', '#ffd23f', '#ff8fb8', '#9fe3ff'] as const; // TUNE

/** Kelp and coral colours, foot to tip. */
export const WATER_COLORS = {
  kelp: [
    ['#3a9a78', '#8fe8a8'],
    ['#3f9f7a', '#a4eeb0'],
    ['#34928a', '#7adcb4'],
  ],
  coral: ['#ff8fb0', '#ffb07a', '#c9a0ff'],
  reed: ['#4f9a6a', '#a8e08a'],
} as const; // TUNE

/** Per tier: the share of the bubbles drawn (instances are shuffled by phase, so any share spreads evenly). */
export const WATER_TIERS: Readonly<Record<QualityTier, { readonly bubbles: number }>> = {
  high: { bubbles: 1 }, // TUNE
  medium: { bubbles: 0.7 }, // TUNE
  low: { bubbles: 0.4 }, // TUNE
};

/** Ambient motion: sway strength (world units per unit height²) and how bubbles rise. */
export const WATER_MOTION = {
  kelp: 0.07, // TUNE
  coral: 0.01, // TUNE
  /** Bubbles: how high they rise, how fast (cycles are 10 ÷ speed seconds), size. */
  bubble: { rise: [1.6, 2.6], speed: [1.6, 2.6], size: [0.05, 0.12] }, // TUNE
  /** Fish: circle radius, speed, height above the bed, length scale. */
  fish: { radius: [0.7, 1.7], speed: [0.35, 0.6], lift: [0.7, 2.0], size: [0.9, 1.3] }, // TUNE
  /** The glow of bubbles, times their colour (over 1 blooms at night). */
  glow: 1.1, // TUNE
} as const;

/** The haze under water, world units from the camera (the camera is about 7 from the Keeper). */
export const WATER_HAZE = { start: 10, end: 36 } as const; // TUNE

/** Caustic light on the sand: colour, strength and scale (per world unit). */
export const CAUSTICS = { color: [0.85, 1, 0.95], strength: 0.12, scale: 1.6 } as const; // TUNE
