import type { LandLook, LandShape } from './land-config.js';

/**
 * The Wild Isle river bank on the meadow's land kit (#621 W1-13): a grassy,
 * pebbly bank with the river flowing round its back in a lazy bend, and a
 * far bank of willows and cattails across the water. Same pieces, light and
 * layout as the meadow; only the numbers and colours differ (art bible: one
 * family). Every number is a first guess to judge on the playtest devices.
 */

const SHAPE: LandShape = {
  // A soft, mostly level bank: the water level is read from the middle, so
  // the grass must not roll much.
  bumps: { height: 0.1, scale: 0.16 }, // TUNE
  ripples: { height: 0.025, scale: 0.6 }, // TUNE
  rises: { count: 2, height: 0.18, width: 1.5 }, // TUNE: little grassy humps
  edge: 6.9, // TUNE: just past the tile's corners (6.65)
  // The bank slopes into the river past the edge. No far hills: the far bank
  // is the river's own layer.
  fall: { depth: 6, length: 2.2 }, // TUNE
  hills: { height: 0, scale: 0.06 }, // TUNE
  path: { width: 0.75, sway: 1.1, bend: 0.32, sink: 0.025 }, // TUNE: a worn fishing trail
};

/** Where the river sits and how it looks. World units. */
export const RIVER = {
  /** The water's surface, below the grass's level (about 0). */
  level: -0.45, // TUNE
  /** The channel's middle and the pale shallows by each bank: colours, sRGB hex. */
  deep: '#2f8d9c', // TUNE: a greener teal than the sea
  shallows: '#78cbbd', // TUNE
  /** How far the shallows reach out from the near bank, and the river's width to the far bank. */
  shallowReach: 1.4, // TUNE
  width: 6.5, // TUNE: past the near bank's shoreline
  /** The far bank: how far it climbs above the water, and how far out it reaches. */
  farBank: { rise: 0.55, slope: 1.6, reach: 70 }, // TUNE
  /** The far bank's grass, from its wet foot to its sunny top. */
  farGrass: ['#5f8f4f', '#86b862', '#a3cd78'], // TUNE
  /** The far bank's wet, pebbly foot at the waterline. */
  farMud: '#8a7a5e', // TUNE
  /** The current's ripples: pale streaks running with the flow, and the wakes behind rocks. */
  ripple: '#d8f5ee', // TUNE
  wake: '#f4fffb', // TUNE
  /** How many streaks ride the current, and their length range, world units. */
  streaks: 110, // TUNE
  streakLength: [0.6, 1.5], // TUNE
  /**
   * The way the river runs: +1 is left to right across the back of the view
   * (clockwise seen from above, +z away from the camera), -1 the other way.
   */
  flow: 1, // TUNE
} as const;

/** The bearings (degrees, 90 = straight back from the camera) of the river's crossings. */
export const CROSSINGS = {
  /** Stepping stones from the bank to the far side. */
  stones: 86, // TUNE: just right of straight back
  /** A fallen log lying across the river. */
  log: 108, // TUNE: just left of straight back
  /** A little wooden jetty on the near bank. */
  jetty: 68, // TUNE: back-right
  /** A rope swing from a willow on the far bank, hanging over the water. */
  swing: 97, // TUNE
} as const;

/**
 * Where the grassy bank meets the water: the radius where the slope has
 * dropped to the river's level (the slope is `depth · t² / (1 + t²)` with t
 * the distance past the edge over its length).
 */
export function bankRadius(shape: LandShape = SHAPE): number {
  const u = -RIVER.level / shape.fall.depth;
  return shape.edge + shape.fall.length * Math.sqrt(u / (1 - u));
}

/** Where the far bank's waterline is: the near bank's plus the river's width. */
export function farBankRadius(): number {
  return bankRadius() + RIVER.width;
}

export const RIVER_LOOK: LandLook = {
  palette: {
    grass: ['#7fb35f', '#95c46c', '#acd47f'], // TUNE: lush bank grass
    sunny: '#c4e08e', // TUNE
    path: '#b59a6c', // TUNE: a trodden, pebbly trail
    pathEdge: '#9a8058', // TUNE
    specks: ['#d8d0c4', '#b9b2a8', '#efe7da', '#ffe28a'], // TUNE: river pebbles, buttercups
    shade: '#4f6e40', // TUNE
  },
  shape: SHAPE,
  growth: {
    tufts: { inside: 1.1, outside: 0.9 }, // TUNE: long bank grass
    flowers: { inside: 0.08, outside: 0.2 }, // TUNE: buttercups and forget-me-nots
    bushes: { edge: 0, outside: 0 }, // TUNE: the reeds are the river's own layer
    trees: { near: 0, far: 0 }, // TUNE: willows are the river's own layer
    rocks: 0, // TUNE: river rocks are the river's own layer
    logs: 0, // TUNE
    mushrooms: 0, // TUNE: the mossy logs carry their own
    pebbles: 70, // TUNE: a pebbly bank
    lamps: 0, // TUNE
    butterflies: 4, // TUNE: dragonfly-ish flutters by day
    pollen: 10, // TUNE
    fireflies: 34, // TUNE: the river's dusk glow
  },
};
