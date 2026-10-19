import type { CommunityRules } from '../schemas/data/communities.js';

/**
 * Hollowed Communities (#306): the village kinds and what restoring costs
 * (owner decision 1 of 2026-10-18: about 6 Timber + 4 Stone by terrain plus
 * exactly 1 Heartdust a piece; pieces a tile grow with the village). Where
 * villages go is `MAP_GEN.communities`.
 */
export const COMMUNITY_RULES: CommunityRules = {
  kinds: [
    {
      id: 'lantern-tower',
      name: 'Lantern Tower',
      emoji: '🏮',
      perk: 'Its light keeps the village and the land around it lit at night.',
    },
    { id: 'workshop', name: 'Workshop', emoji: '🛠️', perk: 'One more Factory batch slot.' },
    {
      id: 'old-well',
      name: 'Old Well',
      emoji: '⛲',
      perk: '2 Water and 2 Greens in your mailbox every morning.',
    },
    { id: 'bakery', name: 'Bakery', emoji: '🥧', perk: '3 Treats in your mailbox every morning.' },
    {
      id: 'watchtower',
      name: 'Watchtower',
      emoji: '🗼',
      perk: 'Village tiles hold 4 guards instead of 3.',
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
  restoredSuffixes: ['Glen', 'Meadow', 'Hearth', 'Rise'],
};
