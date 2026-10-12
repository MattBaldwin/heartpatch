import type { HouseGiftTable } from '../../schemas/data/house-gifts.js';

/**
 * The house's daily gift (#381 PR H, plan §1c): what a resident at home can
 * leave its Keeper, by house level. Secret (CLAUDE.md rule 6): rolled on the
 * server from the map seed, never sent to the client. Small, so it's a hello,
 * not a farm.
 */
export const HOUSE_GIFTS: HouseGiftTable = {
  perDay: 1, // one row a day per Keeper (`house_gifts`); not tunable without a migration
  table: [
    {
      fromLevel: 1,
      gifts: [
        { itemId: 'timber', min: 2, max: 4, weight: 3 }, // TUNE:
        { itemId: 'stone', min: 2, max: 4, weight: 3 }, // TUNE:
        { itemId: 'greens', min: 2, max: 3, weight: 2 }, // TUNE:
        { itemId: 'treats', min: 1, max: 2, weight: 2 }, // TUNE:
      ],
    },
    {
      fromLevel: 2,
      gifts: [
        { itemId: 'timber', min: 3, max: 5, weight: 3 }, // TUNE:
        { itemId: 'stone', min: 3, max: 5, weight: 3 }, // TUNE:
        { itemId: 'greens', min: 2, max: 4, weight: 2 }, // TUNE:
        { itemId: 'water', min: 2, max: 3, weight: 2 }, // TUNE:
        { itemId: 'treats', min: 2, max: 3, weight: 2 }, // TUNE:
      ],
    },
    {
      fromLevel: 3,
      gifts: [
        { itemId: 'timber', min: 4, max: 6, weight: 3 }, // TUNE:
        { itemId: 'stone', min: 4, max: 6, weight: 3 }, // TUNE:
        { itemId: 'treats', min: 2, max: 4, weight: 2 }, // TUNE:
        { itemId: 'emberwood', min: 1, max: 2, weight: 2 }, // TUNE:
        { itemId: 'glimmer', min: 1, max: 1, weight: 1 }, // TUNE: a little Glimmer now and then
      ],
    },
    {
      fromLevel: 4,
      gifts: [
        { itemId: 'timber', min: 5, max: 8, weight: 3 }, // TUNE:
        { itemId: 'stone', min: 5, max: 8, weight: 3 }, // TUNE:
        { itemId: 'treats', min: 3, max: 4, weight: 2 }, // TUNE:
        { itemId: 'emberwood', min: 2, max: 3, weight: 2 }, // TUNE:
        { itemId: 'glimmer', min: 1, max: 2, weight: 2 }, // TUNE:
      ],
    },
  ],
};
