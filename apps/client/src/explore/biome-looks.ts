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
      grass: ['#86a889', '#a4bf98', '#c0d3a8'], // TUNE
      sunny: '#d3dfae', // TUNE
      path: '#f3e6c6', // TUNE
      pathEdge: '#d6c295', // TUNE
      specks: ['#f4f1ff', '#e1e8ff', '#fff4c2', '#ffd6e6'], // TUNE
      shade: '#566888', // TUNE
    },
    shape: {
      bumps: { height: 0.3, scale: 0.14 }, // TUNE
      ripples: { height: 0.05, scale: 0.6 }, // TUNE
      rises: { count: 4, height: 0.5, width: 1.4 }, // TUNE
      edge: 7.0, // TUNE
      fall: { depth: 14, length: 8 }, // TUNE
      hills: { height: 3.4, scale: 0.06 }, // TUNE
      path: { width: 0.8, sway: 2.2, bend: 0.5, sink: 0.03 }, // TUNE
    },
    growth: {
      tufts: { inside: 4, outside: 2.5 }, // TUNE
      flowers: { inside: 0.1, outside: 0.2 }, // TUNE
      bushes: { edge: 14, outside: 12 }, // TUNE
      trees: { near: 14, far: 60 }, // TUNE
      rocks: 22, // TUNE
      logs: 1, // TUNE
      mushrooms: 2, // TUNE
      pebbles: 40, // TUNE
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
      grass: ['#6a5a8c', '#7b6a9f', '#8d7bb2'], // TUNE
      sunny: '#a091c4', // TUNE
      path: '#d9c4a6', // TUNE
      pathEdge: '#a8957f', // TUNE
      specks: ['#8ef0ff', '#ffb8e0', '#e9dcff', '#c9a8ff'], // TUNE
      shade: '#241838', // TUNE
    },
    shape: {
      bumps: { height: 0.22, scale: 0.18 }, // TUNE
      ripples: { height: 0.06, scale: 0.7 }, // TUNE
      rises: { count: 3, height: 0.36, width: 1.5 }, // TUNE
      edge: 7.0, // TUNE
      fall: { depth: 10, length: 10 }, // TUNE
      hills: { height: 1.2, scale: 0.08 }, // TUNE
      path: { width: 0.85, sway: 1.6, bend: 0.4, sink: 0.04 }, // TUNE
    },
    growth: {
      tufts: { inside: 0, outside: 0 }, // TUNE: stone, not grass
      flowers: { inside: 0, outside: 0 }, // TUNE
      bushes: { edge: 0, outside: 0 }, // TUNE
      trees: { near: 0, far: 0 }, // TUNE
      rocks: 12, // TUNE
      logs: 0, // TUNE
      mushrooms: 0, // TUNE
      pebbles: 40, // TUNE
      lamps: 0, // TUNE
      butterflies: 0, // TUNE
      pollen: 0, // TUNE
      fireflies: 40, // TUNE: the cave's glow motes
    },
  },
};
