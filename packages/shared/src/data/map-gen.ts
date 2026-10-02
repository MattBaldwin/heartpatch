import type { MapGenSettings } from '../schemas/data/map-gen.js';

/** Map generator settings (design doc §3, §11). */
export const MAP_GEN: MapGenSettings = {
  layouts: [
    { players: 2, radius: 9, homeDistance: 6 }, // TUNE: design doc §3 (271 tiles)
    { players: 3, radius: 11, homeDistance: 7 }, // TUNE: design doc §3 (397 tiles)
    { players: 4, radius: 12, homeDistance: 8 }, // TUNE: design doc §3 (469 tiles)
  ],
  gapRadius: 1, // TUNE: 7 Gap tiles
  gapTerrain: 'junipers-gap',
  homeTerrain: 'meadow',
  homeRingNodes: ['timber', 'stone', 'emberwood', 'treats'], // decision B: treats = farm plot
  patchSize: 6, // TUNE:
  guardianStrength: { min: 1, max: 4, stepsPerLevel: 2, gap: 5 }, // TUNE:
};
