import type { HouseData } from '../schemas/data/house.js';

/*
 * The Keeper's house (#381 plan §3). Every number is a guess until
 * `pnpm sim:house` tunes it. Levels 5+ are data room: nothing in code says 4.
 * Grid cells are about 1.6 m; the dollhouse front faces south (+gy goes back).
 */
export const HOUSE_DATA: HouseData = {
  rules: {
    perk: { kind: 'slower-drain', drainPercent: 50 }, // TUNE: owner: "fades 50% slower"
    moveBackInHours: 24, // TUNE: coordinator call (plan Q5)
    // The daily gift (plan §1c): small, so it's a hello, not a farm.
    gifts: {
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
    },
  },
  levels: [
    {
      level: 1,
      name: 'The Snug',
      requirements: [],
      cost: {},
      room: {
        id: 'snug',
        name: 'The Snug',
        description: 'A cozy room by the fire, just right for two.',
        beds: 2, // TUNE:
        look: 'snug',
        layout: { floor: 0, gx: 0, gy: 0, w: 3, d: 3, storeys: 1, door: 'south' },
      },
      exterior: 'hut',
    },
    {
      level: 2,
      name: 'The Playroom',
      requirements: [
        { kind: 'heartSeedLevel', level: 1 }, // TUNE: everyone
        { kind: 'buildingsBuilt', buildingKind: 'habitat', count: 2 }, // TUNE:
        { kind: 'litFires', count: 1 }, // TUNE:
        { kind: 'residentsContent', mood: 'happy', count: 1 }, // TUNE:
        { kind: 'tilesTended', count: 8 }, // TUNE:
      ],
      cost: { timber: 30, stone: 20 }, // TUNE:
      room: {
        id: 'playroom',
        name: 'The Playroom',
        description: 'Toys everywhere and room to bounce!',
        beds: 2, // TUNE:
        look: 'playroom',
        layout: { floor: 0, gx: 3, gy: 0, w: 3, d: 3, storeys: 1, door: 'west' },
      },
      exterior: 'wing',
    },
    {
      level: 3,
      name: 'The Kitchen',
      requirements: [
        { kind: 'heartSeedLevel', level: 2 }, // TUNE:
        { kind: 'habitatKinds', count: 2 }, // TUNE:
        { kind: 'buildingsBuilt', count: 4 }, // TUNE:
        { kind: 'litFires', count: 2 }, // TUNE:
        { kind: 'residentsContent', mood: 'happy', count: 3 }, // TUNE:
        { kind: 'residentsLevel', level: 10, count: 2 }, // TUNE:
        { kind: 'tradesCompleted', count: 2 }, // TUNE:
        { kind: 'tilesTended', count: 16 }, // TUNE:
        { kind: 'homesteads', count: 1 }, // TUNE:
      ],
      cost: { timber: 60, stone: 50, glimmer: 4 }, // TUNE:
      room: {
        id: 'kitchen',
        name: 'The Kitchen',
        description: 'Up the stairs, where the cocoa is always warm.',
        beds: 2, // TUNE:
        look: 'kitchen',
        layout: { floor: 1, gx: 0, gy: 0, w: 3, d: 3, storeys: 1, door: 'east' },
      },
      exterior: 'loft',
    },
    {
      level: 4,
      name: 'The Heart Hall',
      requirements: [
        { kind: 'heartSeedLevel', level: 3 }, // TUNE:
        { kind: 'habitatKinds', count: 3 }, // TUNE:
        { kind: 'buildingsBuilt', count: 8 }, // TUNE:
        { kind: 'decorations', count: 5 }, // TUNE: furniture is Phase 2
        { kind: 'litFires', count: 4 }, // TUNE:
        { kind: 'residentsContent', mood: 'glowing', count: 6 }, // TUNE:
        { kind: 'residentsLevel', level: 16, count: 3 }, // TUNE:
        { kind: 'residentsEvolved', count: 1 }, // TUNE:
        { kind: 'tradesCompleted', count: 10 }, // TUNE:
        { kind: 'patchMatesTradedWith', count: 3 }, // TUNE:
        { kind: 'postsUsed', count: 3 }, // TUNE:
        { kind: 'tilesTended', count: 40 }, // TUNE:
        { kind: 'homesteads', count: 4 }, // TUNE:
      ],
      cost: { timber: 200, stone: 150, glimmer: 20, heartdust: 6 }, // TUNE:
      room: {
        id: 'heart-hall',
        name: 'The Heart Hall',
        description: 'A grand hall with a balcony, lanterns and tall windows.',
        beds: 4, // TUNE:
        look: 'heart-hall',
        layout: { floor: 0, gx: 0, gy: 3, w: 6, d: 4, storeys: 2, door: 'south' },
      },
      exterior: 'heart-tree',
      final: true,
    },
  ],
};
