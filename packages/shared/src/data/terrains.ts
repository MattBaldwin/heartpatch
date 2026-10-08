import type { Terrain } from '../schemas/data/terrains.js';

/** Terrain from design doc §11–12, plus Juniper's Gap at the centre of every map. */
export const TERRAINS: Terrain[] = [
  {
    id: 'meadow',
    name: 'Meadow',
    description: 'Soft, open grass full of Greens. A lovely spot to build.',
    weight: 30, // TUNE:
    // No gather spot, so a fire always fits (#238): a gatherer on the land
    // picks its Greens (JOB_RULES.terrainYields).
    nodeChance: 0,
    nodeResources: [],
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Tall, friendly trees full of Timber.',
    weight: 20, // TUNE:
    nodeChance: 40, // TUNE:
    nodeResources: ['timber'],
    // A rarer Greens spot on some forests (#238), so the Keeper can pick Greens too.
    extraNodes: [{ resource: 'greens', chance: 25 }], // TUNE: #238
  },
  {
    id: 'old-forest',
    name: 'Old Forest',
    description: 'Ancient, mossy trees. Emberwood grows here.',
    weight: 12, // TUNE:
    nodeChance: 40, // TUNE:
    nodeResources: ['emberwood'],
  },
  {
    id: 'hills',
    name: 'Hills',
    description: 'Rolling, bumpy hills. Great for finding Stone.',
    weight: 14, // TUNE:
    nodeChance: 40, // TUNE:
    nodeResources: ['stone'],
  },
  {
    id: 'mountains',
    name: 'Mountains',
    description: 'Big, chilly peaks of Ice, with Glimmer tucked inside.',
    weight: 8, // TUNE:
    nodeChance: 50, // TUNE:
    nodeResources: ['stone', 'glimmer'],
  },
  {
    id: 'lake',
    name: 'Lake',
    description: 'Still, sparkly water. The fish wave hello.',
    weight: 8, // TUNE:
    nodeChance: 0,
    nodeResources: [],
    extraNodes: [{ resource: 'water', chance: 100 }], // TUNE: #238, a well on every lake
  },
  {
    id: 'pumpkin-fields',
    name: 'Pumpkin Fields',
    description: 'Rows and rows of grinning pumpkins.',
    weight: 8, // TUNE:
    nodeChance: 50, // TUNE: Pumpkins only gather in their season
    nodeResources: ['pumpkins'],
  },
  {
    id: 'junipers-gap',
    name: "Juniper's Gap",
    description: 'The valley where the Heartpatch once glowed.',
    weight: 0, // only placed at the map centre
    nodeChance: 100, // TUNE: the richest land
    nodeResources: ['glimmer', 'emberwood', 'stone', 'timber'],
  },
];
