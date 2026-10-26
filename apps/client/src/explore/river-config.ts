import { EXPLORE_RULES } from '@heartpatch/shared';
import { EXPLORE_VIEW } from './explore-config.js';
import type { LandBank, LandLook, LandShape } from './land-config.js';

/**
 * The Wild Isle river bank on the meadow's land kit (#621 W1-13): the tile
 * is the bank itself. From the meadow at the front, a pebbly shore runs down
 * to clear, walkable shallows along the tile's two back edges, and past them
 * (past where the Keeper can go) the river runs deep and dark round a lazy
 * bend, with a far bank of willows and cattails across the water. Same pieces, light and
 * layout as the meadow; only the numbers and colours differ (art bible: one
 * family). Every number is a first guess to judge on the playtest devices.
 */

/**
 * The river's spot band (shared data): the server places every river spot
 * from the waterline out, so the waterline is where the band starts.
 */
const SPOT_BAND = EXPLORE_RULES.terrains.find((t) => t.terrain === 'river')?.band?.depth ?? 0.44;

/** The water's surface: the grass's middle is at 0. */
const LEVEL = -0.14; // TUNE

/**
 * The bank's bands, as a share of the way from the middle to the tile's back
 * edges (`bankReach`). The Keeper's clamp reaches about 0.93 along an edge
 * and 0.86 into the back corner, so the drop to the deep sits past both.
 */
export const BANK: LandBank = {
  shore: 0.42, // TUNE: the grass ends; pebbly sand runs down to the water
  water: 1 - SPOT_BAND, // the waterline: the spots' band starts here (tune it in the shared data)
  bed: 0.66, // TUNE: the shallows' sandy floor, ankle-deep
  drop: 0.97, // TUNE: past the clamp, the floor falls away…
  deep: 1.12, // TUNE: …to the deep channel
  level: LEVEL,
  floor: 0.22, // TUNE: the shallows' depth: a paddle, not a swim
  bottom: 2.6, // TUNE
  dry: 0.1, // TUNE: the meadow's lowest dip, over the water's surface
  // Each spot on the bank sits where it belongs: the eddy and the cattails
  // out in the shallows, the pebble bar a spit just out of the water, the
  // mossy log on the wet sand at the water's edge.
  pads: { eddy: -0.24, cattails: -0.14, 'pebble-bar': 0.05, 'mossy-log': 0.07 }, // TUNE
  padReach: 1.15, // TUNE
  jetty: {
    bearings: [68, 112, 52, 128, 84, 96], // TUNE: back-right first
    clear: 1.05, // TUNE: a spot's prop is about this round
    length: 1.85, // TUNE: its end stays inside the clamp
    width: 1.0, // TUNE
    deck: 0.26, // TUNE
  },
};

/**
 * How far the near bank's reeds stand off each spot, world units past its
 * collider (`gap`), all along a strip `front` long from it towards the
 * camera, where the Keeper stands to search and a clump would hide it.
 */
export const REED_CLEAR = { gap: 0.9, front: 1.4 } as const; // TUNE

const SHAPE: LandShape = {
  // A soft, mostly level meadow: the water's surface is fixed, so the grass
  // must not roll much.
  bumps: { height: 0.06, scale: 0.16 }, // TUNE
  ripples: { height: 0.025, scale: 0.6 }, // TUNE
  rises: { count: 2, height: 0.18, width: 1.5 }, // TUNE: little grassy humps
  edge: 6.9, // TUNE: just past the tile's corners (6.65)
  // The bank slopes into the river past the edge. No far hills: the far bank
  // is the river's own layer.
  fall: { depth: 6, length: 2.2 }, // TUNE
  hills: { height: 0, scale: 0.06 }, // TUNE
  path: { width: 0.75, sway: 1.1, bend: 0.32, sink: 0.025 }, // TUNE: a worn fishing trail
  bank: BANK,
};

/** Where the river sits and how it looks. World units. */
export const RIVER = {
  /** The water's surface, below the grass's level (0 at the middle). */
  level: LEVEL,
  /** The deep channel and the clear shallows over the sand: colours, sRGB hex. */
  deep: '#1f6f86', // TUNE: a dark, greener teal than the sea
  shallows: '#9fe3d6', // TUNE
  /** How see-through the shallows are (0 clear, 1 solid), and the deep. */
  shallowAlpha: 0.38, // TUNE: the sandy bed shows through
  deepAlpha: 0.94, // TUNE
  /** How far the shallows reach out past the near bank's deep edge, and the river's width to the far bank. */
  shallowReach: 1.4, // TUNE
  width: 4.6, // TUNE: close enough that the willows and the rope swing read
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

/**
 * The bearings (degrees, 90 = straight back from the camera) of the far
 * bank's landmarks. Nothing crosses the river: the deep is past the clamp.
 */
export const CROSSINGS = {
  /** A rope swing from a willow on the far bank, hanging over the water. */
  swing: 97, // TUNE
} as const;

/**
 * Where the near bank's deep water starts, straight back from the middle:
 * the shallows' drop (the back corner is `hexSize` out, at a reach of 1).
 */
export function bankRadius(): number {
  return EXPLORE_VIEW.hexSize * BANK.drop + 0.35;
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
    bank: { sand: '#cdbb98', wet: '#9a8a6c', bed: '#c9b48a' }, // TUNE: pebbly sand, wet sand, the shallows' bed
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
    fireflies: 90, // TUNE: the river's dusk glow, plenty of it
  },
};
