import type { LandLook, LandShape } from './land-config.js';

/**
 * The Wild Isle coast on the meadow's land kit (#621 W1-11): a sandy tile
 * ringed by the sea, with a bright foam line where the water laps. Same
 * pieces, light and layout as the meadow; only the numbers and colours
 * differ (art bible: one family). Every number is a first guess to judge on
 * the playtest devices.
 */

const SHAPE: LandShape = {
  // A gentle, nearly flat beach: the sea level is read from the middle, so
  // the sand must not roll much.
  bumps: { height: 0.08, scale: 0.16 }, // TUNE
  ripples: { height: 0.03, scale: 0.7 }, // TUNE: wind-rippled sand
  rises: { count: 2, height: 0.2, width: 1.6 }, // TUNE: little dunes
  edge: 6.9, // TUNE: just past the tile's corners (6.65)
  // The sand shelves into the sea past the edge. No far hills: the sea hides them.
  fall: { depth: 8, length: 3 }, // TUNE
  hills: { height: 0, scale: 0.06 }, // TUNE
  path: { width: 0.8, sway: 1.2, bend: 0.3, sink: 0.02 }, // TUNE: a damp, trodden strip
};

/** Where the sea sits and how it looks. World units. */
export const SEA = {
  /** The water's surface, below the sand's level (about 0). */
  level: -0.5, // TUNE
  /** The open sea and the pale shallows near the sand: colours, sRGB hex. */
  deep: '#3fb3c9', // TUNE
  shallows: '#86e0e0', // TUNE
  /** How far out the shallows reach past the shoreline, and the sea's radius. */
  shallowReach: 3.2, // TUNE
  radius: 70, // TUNE: past the haze
  /** The surf line's foam: its colour and how wide the lapping band is. */
  foam: '#ffffff', // TUNE
  /** The pale wash under the foam, where the water thins out over the sand. */
  wash: '#c4f3f1', // TUNE
  foamBand: { from: -0.35, to: 0.9 }, // TUNE: world units out from the shoreline
} as const;

/**
 * Where the flat sand meets the sea: the radius where the shelf has dropped
 * to the sea's level (the shelf is `depth · t² / (1 + t²)` with t the
 * distance past the edge over its length).
 */
export function shoreRadius(shape: LandShape = SHAPE): number {
  const u = -SEA.level / shape.fall.depth;
  return shape.edge + shape.fall.length * Math.sqrt(u / (1 - u));
}

export const COAST_LOOK: LandLook = {
  palette: {
    grass: ['#ecd7a4', '#f3e2b6', '#f9ecca'], // TUNE: warm sand
    sunny: '#fdf0d0', // TUNE
    path: '#d9bf8c', // TUNE: damp sand
    pathEdge: '#c3a56f', // TUNE
    specks: ['#fff7e6', '#ffd3df', '#d3eef2', '#f6c9ac'], // TUNE: tiny shell bits
    shade: '#a38a62', // TUNE
  },
  shape: SHAPE,
  growth: {
    tufts: { inside: 0.5, outside: 0.4 }, // TUNE: sparse dune grass
    flowers: { inside: 0.03, outside: 0.12 }, // TUNE: a few beach blooms
    bushes: { edge: 0, outside: 0 }, // TUNE
    trees: { near: 0, far: 0 }, // TUNE: the palms are the coast's own layer
    rocks: 0, // TUNE: sea rocks are the coast's own layer
    logs: 0, // TUNE: driftwood is the coast's own layer
    mushrooms: 0, // TUNE
    pebbles: 50, // TUNE
    lamps: 0, // TUNE
    butterflies: 0, // TUNE
    pollen: 8, // TUNE: sea spray
    fireflies: 14, // TUNE
  },
};
