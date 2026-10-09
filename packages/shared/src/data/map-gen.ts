import type { MapGenSettings } from '../schemas/data/map-gen.js';

/**
 * Map generator settings (design doc §3, §11). When retuning a layout, keep
 * the mapgen "equal share of the map" test green: with 4 players only some
 * home distances (e.g. 4 and 8 at radius 12) split the land exactly evenly.
 */
export const MAP_GEN: MapGenSettings = {
  layouts: [
    { players: 2, radius: 9, homeDistance: 6 }, // TUNE: design doc §3 (271 tiles)
    { players: 3, radius: 11, homeDistance: 7 }, // TUNE: design doc §3 (397 tiles)
    { players: 4, radius: 12, homeDistance: 8 }, // TUNE: design doc §3 (469 tiles)
    // #318 (owner decision 2026-10-09): six homes, a sixth of the way round
    // from each other, so every split is exact; neighbours 10 apart, as at 4.
    { players: 6, radius: 16, homeDistance: 10 }, // TUNE: 817 tiles
  ],
  gapRadius: 1, // TUNE: 7 Gap tiles
  gapTerrain: 'junipers-gap',
  homeTerrain: 'meadow',
  // Decision B: treats = farm plot. Seasonal nodes (owner decision 2026-10-06,
  // design-review Q6) only show and gather in their season, so every kid can
  // carve a Jack-o'-Lantern without map luck. Maps made before they were added
  // get them when their homes are next read (server `seedHomeRingNodes`).
  homeRingNodes: ['timber', 'stone', 'emberwood', 'treats', 'pumpkins', 'magic-fallen-leaves'],
  patchSize: 6, // TUNE:
  guardianStrength: { min: 1, max: 4, stepsPerLevel: 2, gap: 5 }, // TUNE:
  // Trading posts (#269, owner decision 4 on #30): 4 a map (one per home on
  // a 6-seat map, #318), every home slot within 5 steps of one, none
  // touching a home ring on day 1.
  tradingPosts: {
    perMap: 4,
    maxFromSeed: 5, // TUNE: the owner's N, from the Heart Seed (4 from the home ring)
    minFromSeed: 3, // TUNE: claim one tile toward it and it's connected
    minApart: 4, // TUNE:
    names: [
      'Acorn Crossing',
      'Lantern Post',
      'Mossy Mailbox',
      'Puddle Junction',
      'Pumpkin Stop',
      'Snuggle Station',
    ],
  },
};
