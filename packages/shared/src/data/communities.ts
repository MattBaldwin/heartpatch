import type { CommunityRules } from '../schemas/data/communities.js';

/**
 * Hollowed Communities (#306): the village kinds and what restoring costs
 * (owner decision 1 of 2026-10-18: about 6 Timber + 4 Stone by terrain plus
 * exactly 1 Heartdust a piece; pieces a tile grow with the village). Where
 * villages go is `MAP_GEN.communities`.
 */
export const COMMUNITY_RULES: CommunityRules = {
  // Perks (#306 PR 3b, plan Q4).
  kinds: [
    {
      id: 'lantern-tower',
      name: 'Lantern Tower',
      emoji: '🏮',
      perk: 'light all around it at night',
      // TUNE: plan "radius 1 from every village tile": the ring and one tile past it.
      effect: { type: 'light', radius: 2 },
    },
    {
      id: 'workshop',
      name: 'Workshop',
      emoji: '🛠️',
      perk: 'one more Factory batch',
      effect: { type: 'factory-batches', extra: 1 }, // TUNE:
    },
    {
      id: 'old-well',
      name: 'Old Well',
      emoji: '⛲',
      perk: 'Water and Greens every morning',
      effect: { type: 'morning-gift', items: { water: 2, greens: 2 } }, // TUNE: plan Q4
    },
    {
      id: 'bakery',
      name: 'Bakery',
      emoji: '🥧',
      perk: 'Treats every morning',
      effect: { type: 'morning-gift', items: { treats: 3 } }, // TUNE: plan Q4
    },
    {
      id: 'watchtower',
      name: 'Watchtower',
      emoji: '🗼',
      perk: 'one more guard on every tile',
      effect: { type: 'guards', extra: 1 }, // TUNE: plan Q4 (not built yet)
    },
  ],
  // TUNE: 4-tile villages 3 a tile, 5–6 tiles 4, 7 tiles 5.
  piecesBySize: { '4': 3, '5': 4, '6': 4, '7': 5 },
  // TUNE: by the tile's terrain; `default` for the rest.
  pieceCost: {
    meadow: { timber: 6, stone: 4 },
    hills: { timber: 4, stone: 6 },
    forest: { timber: 8, stone: 2 },
    default: { timber: 6, stone: 4 },
  },
  heartdustPerPiece: 1,
  joyResource: 'heartdust',
  heartdustFindMultiplier: 3, // TUNE: Hollowed searches find Heartdust 3× as often
  echoesPerTile: 1, // TUNE: plan v3, one echo a patch tile (the far Hollow has two)
  restoredSuffixes: ['Glen', 'Meadow', 'Hearth', 'Rise'],
};
