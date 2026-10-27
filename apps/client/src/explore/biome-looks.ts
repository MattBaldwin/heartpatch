import { CELLAR_LOOK } from '../hollowed/cellar-look.js';
import { COAST_LOOK } from './coast-config.js';
import { RIVER_LOOK } from './river-config.js';
import type { LandLook } from './land-config.js';

/**
 * The mountain trail and the hills cave on the meadow's land kit (#335 art
 * reset). Same pieces, same layout and light as the meadow; only the numbers
 * and colours differ (art bible: one family, so they read as one game).
 * Every number is a first guess to judge on the playtest devices.
 */
export const BIOME_LOOKS: Readonly<Record<string, LandLook>> = {
  // A high alpine slope: sage and lavender grass, a pale switchback path,
  // pines and boulders, big hills behind.
  mountains: {
    palette: {
      grass: ['#7f9f86', '#97b59a', '#b5caa5'], // TUNE: alpine sage
      sunny: '#d9e0b8', // TUNE
      path: '#cdbfa6', // TUNE: a stone path
      pathEdge: '#a8987c', // TUNE
      specks: ['#f4f1ff', '#e1e8ff', '#fff4c2', '#ffd6e6'], // TUNE
      shade: '#5a6a86', // TUNE
    },
    shape: {
      bumps: { height: 0.3, scale: 0.14 }, // TUNE
      ripples: { height: 0.05, scale: 0.6 }, // TUNE
      rises: { count: 5, height: 0.7, width: 1.5 }, // TUNE: more slope
      edge: 7.0, // TUNE
      fall: { depth: 14, length: 8 }, // TUNE
      hills: { height: 4.2, scale: 0.06 }, // TUNE
      path: { width: 0.8, sway: 2.2, bend: 0.5, sink: 0.03 }, // TUNE
    },
    growth: {
      tufts: { inside: 3.5, outside: 2.5 }, // TUNE: thick alpine grass
      flowers: { inside: 0.15, outside: 0.4 }, // TUNE: alpine daisies and bells
      bushes: { edge: 10, outside: 6 }, // TUNE
      trees: { near: 12, far: 22 }, // TUNE
      treeMix: { oak: 0.05, birch: 0.15, pine: 0.8 }, // TUNE: pines up here
      rocks: 30, // TUNE
      logs: 0, // TUNE
      mushrooms: 0, // TUNE
      pebbles: 70, // TUNE
      lamps: 0, // TUNE
      butterflies: 0, // TUNE
      pollen: 24, // TUNE
      fireflies: 24, // TUNE
    },
  },
  // Inside the cave: dusky purple stone underfoot, a sandy trail, glow
  // specks; the walls, crystals and caps come from the cave kit.
  hills: {
    palette: {
      grass: ['#62547f', '#706192', '#7f6fa4'], // TUNE: dusky stone
      sunny: '#8676ab', // TUNE
      path: '#9c8aa8', // TUNE: a muted trail
      pathEdge: '#7a6a8c', // TUNE
      specks: ['#8ef0ff', '#ffb8e0', '#e9dcff', '#c9a8ff'], // TUNE
      shade: '#241838', // TUNE
    },
    shape: {
      bumps: { height: 0.22, scale: 0.18 }, // TUNE
      ripples: { height: 0.06, scale: 0.7 }, // TUNE
      rises: { count: 6, height: 0.45, width: 1.3 }, // TUNE
      edge: 7.0, // TUNE
      fall: { depth: -6, length: 5 }, // TUNE: negative, so the floor rises into the walls
      hills: { height: 1.2, scale: 0.08 }, // TUNE
      path: { width: 0.85, sway: 1.6, bend: 0.4, sink: 0.04 }, // TUNE
    },
    growth: {
      tufts: { inside: 0, outside: 0 }, // TUNE: stone, not grass
      flowers: { inside: 0, outside: 0 }, // TUNE
      bushes: { edge: 0, outside: 0 }, // TUNE
      trees: { near: 0, far: 0 }, // TUNE
      rocks: 0, // TUNE: the walls and stalagmites are the cave's stone (no mossy boulders)
      logs: 0, // TUNE
      mushrooms: 0, // TUNE
      pebbles: 40, // TUNE
      lamps: 0, // TUNE
      butterflies: 0, // TUNE
      pollen: 0, // TUNE
      fireflies: 40, // TUNE: the cave's glow motes
    },
  },
  // Wild Isle (#621 W1-11): a sandy beach ringed by the sea.
  coast: COAST_LOOK,
  // Wild Isle (#621 W1-13): a grassy bank with the river curling round it.
  river: RIVER_LOOK,
  // A Hollow's hidden cellar (#306): a stone vault, its own look.
  cellar: CELLAR_LOOK,
};
