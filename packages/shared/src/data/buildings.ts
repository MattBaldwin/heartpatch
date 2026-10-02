import type { Building } from '../schemas/data/buildings.js';

/**
 * Home-base buildings (design doc §13–15). Ids are stored in `buildings`
 * rows: add freely, never rename or remove one.
 */
export const BUILDINGS: Building[] = [
  {
    id: 'hearthfire',
    kind: 'hearthfire',
    name: 'Hearthfire',
    description: "A warm, bright fire. While it's lit, squishies near it are safe all night.",
    maxPerHome: 1, // TUNE:
    fuelResource: 'emberwood',
    fuelPerNight: 1, // TUNE:
    maxFuelNights: 5, // TUNE: docs/DECISIONS.md, design doc §14
    levels: [
      { cost: { timber: 5, stone: 5 }, safeRadius: 1 }, // TUNE:
      { cost: { timber: 10, stone: 10 }, safeRadius: 2 }, // TUNE:
      { cost: { timber: 20, stone: 15, glimmer: 2 }, safeRadius: 3 }, // TUNE:
    ],
  },
  {
    // Built from the crafted item (#17's recipe), only around Halloween (§15).
    id: 'jack-o-lantern-hearthfire',
    kind: 'hearthfire',
    name: "Jack-o'-Lantern Hearthfire",
    description: 'A grinning, extra-bright fire. Its light reaches further than a plain one.',
    season: 'halloween',
    maxPerHome: 1, // TUNE:
    // The carved pumpkin was a lot of work: it always comes back whole.
    refundPercent: 100, // TUNE:
    fuelResource: 'emberwood',
    fuelPerNight: 1, // TUNE:
    maxFuelNights: 5, // TUNE: same as a plain Hearthfire
    // TUNE: extra-bright, one tile further than a new Hearthfire.
    levels: [{ cost: { 'jack-o-lantern-hearthfire': 1 }, safeRadius: 2 }],
  },
  {
    id: 'ember-den',
    kind: 'habitat',
    name: 'Ember Den',
    description: 'A toasty nook for squishies who love the warmth.',
    maxPerHome: 2, // TUNE:
    tags: { elements: ['fire'], feelings: ['cozy'] },
    levels: [
      { cost: { timber: 5, stone: 3 }, capacity: 3 }, // TUNE:
      { cost: { timber: 10, stone: 6 }, capacity: 5 }, // TUNE:
    ],
  },
  {
    id: 'cozy-meadow',
    kind: 'habitat',
    name: 'Cozy Meadow',
    description: 'Soft grass and sunny spots, perfect for a nap.',
    maxPerHome: 2, // TUNE:
    tags: { elements: ['leaf'], feelings: ['cozy', 'sleepy'] },
    levels: [
      { cost: { timber: 4, stone: 2 }, capacity: 3 }, // TUNE:
      { cost: { timber: 8, stone: 4 }, capacity: 5 }, // TUNE:
    ],
  },
  {
    id: 'training-grounds',
    kind: 'training-grounds',
    name: 'Training Grounds',
    description: 'Squishies practise their best moves here, a little every hour.',
    maxPerHome: 1, // TUNE:
    levels: [
      { cost: { timber: 8, stone: 8 }, capacity: 2, xpPerHour: 5 }, // TUNE:
      { cost: { timber: 16, stone: 16 }, capacity: 3, xpPerHour: 8 }, // TUNE:
    ],
  },
];
