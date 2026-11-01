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
  // Hollowed Communities (#306, owner decisions 4–6 of 2026-10-18 and plan
  // v3): compact grey villages 3–5 steps from a home, one per 2 seats (at
  // least 2), each inside the 7-tile ring its winner earns.
  communities: {
    seatsPerCommunity: 2, // TUNE: "about one per 2 members"
    minPerMap: 2,
    // Owner decision 2026-10-19: one each on a 3-seat patch, whose homes are
    // too far apart to share 2 fairly.
    countBySeats: { '3': 3 },
    size: { min: 4, max: 7 }, // TUNE: the seed plus 3–6 neighbours, never past the ring
    minFromSeed: 3, // TUNE: the rings sit one tile apart
    maxFromSeed: 5, // TUNE:
    relaxedMaxFromSeed: 6, // TUNE: older patches (and a rare lake-heavy new map), before giving up
    ringsApart: 2, // TUNE:
    ringFromPost: 2, // TUNE:
    excludedTerrains: ['lake'],
    requiredKind: 'lantern-tower',
    nameStems: [
      'Bramble',
      'Thistle',
      'Fernwick',
      'Mossbury',
      'Hazelden',
      'Willow',
      'Pebble',
      'Clover',
      'Larkspur',
      'Tansy',
      'Nettle',
      'Cobble',
      'Dewdrop',
      'Hollyhock',
      'Wren',
      'Marrow',
    ],
    nameSuffix: 'Hollow',
  },
  // Wild Isle (#621, plan §2 and revision 1): an island ringed by coast and
  // sea, cut by rivers and real-water lakes (`wild-lake`), with offshore
  // isles the Wave 2 ferry reaches. Cozy Patches never read this block.
  wildIsle: {
    // Owner answer Q6 (2026-10-24): radius 18. Rings 17–18 sea, 16 coast,
    // land inside: 1027 tiles stored. 6 × 11 divides by 6.
    layouts: [{ players: 6, radius: 18, homeDistance: 11, oceanRings: 2 }], // TUNE:
    coastRing: 1,
    oceanTerrain: 'ocean',
    coastTerrain: 'coast',
    riverTerrain: 'river',
    lakeTerrain: 'wild-lake',
    waterMinFromSeed: 3, // TUNE: past TERRITORY_RULES keepRadius (2), so the never-fade zone is land
    homeWaterSteps: 3, // TUNE: every home has a river this close
    // Owner decision 2026-11-01: rivers run sea to sea and split the island
    // (bridges only, no fords); about three on six seats, one past every home.
    rivers: { wiggle: 3, apart: 4, lakePercent: 50 }, // TUNE: apart 4 keeps the land between rivers 3+ wide
    lakes: { count: [2, 4], size: [3, 7] }, // TUNE:
    isles: { count: [2, 3], size: [3, 5], offshore: 1 }, // TUNE:
    minRegionLand: 50, // TUNE:
    landBandPercent: 15, // TUNE: claimable land per home within ±15 % of the average
    attempts: 60, // TUNE: water layouts tried before a RangeError
  },
};
