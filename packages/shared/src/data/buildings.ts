import type { Building } from '../schemas/data/buildings.js';

export const BUILDINGS: Building[] = [
  {
    id: 'hearthfire',
    kind: 'hearthfire',
    name: 'Hearthfire',
    description: 'A warm, bright fire. Squishies near it are safe all night.',
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
    id: 'ember-den',
    kind: 'habitat',
    name: 'Ember Den',
    description: 'A toasty nook for squishies who love the warmth.',
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
    levels: [
      { cost: { timber: 8, stone: 8 }, capacity: 2, xpPerHour: 5 }, // TUNE:
      { cost: { timber: 16, stone: 16 }, capacity: 3, xpPerHour: 8 }, // TUNE:
    ],
  },
];
