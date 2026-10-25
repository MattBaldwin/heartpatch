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
    // Trading posts (#269): shared, never owned, the post's hut on its centre
    // spot. Only placed by `placeTradingPosts`, never scattered.
    id: 'trading-post',
    name: 'Trading Post',
    description: 'A cozy little post where Keepers swap and share.',
    weight: 0,
    nodeChance: 0,
    nodeResources: [],
  },
  {
    // Cleared land (#242): a tile its owner cleared turns into this terrain on
    // its row (`tiles.terrain`), so everything that reads terrain treats it
    // the same everywhere. Never scattered or seeded: no nodes, no extra
    // nodes, no land yield (`JOB_RULES.terrainYields`), no explore layout.
    // Spawns and guardians use the meadow's everyday tables.
    id: 'clearing',
    name: 'Cleared Land',
    description: 'Tidy, open ground, ready for something new.',
    weight: 0,
    nodeChance: 0,
    nodeResources: [],
  },
  {
    id: 'junipers-gap',
    name: "Juniper's Gap",
    description: 'The valley where the Heartpatch once glowed.',
    weight: 0, // only placed at the map centre
    nodeChance: 100, // TUNE: the richest land
    nodeResources: ['glimmer', 'emberwood', 'stone', 'timber'],
  },
  // Wild Isle (#621): only its generator places these, never on a Cozy Patch.
  // The three water kinds are never land (`isWater`): no claim, yield, node,
  // guardian, spawn or explore, and only a `travel` building stands on one.
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Just waves out here. Nothing to claim!',
    weight: 0,
    nodeChance: 0,
    nodeResources: [],
    water: 'deep',
  },
  {
    id: 'river',
    name: 'River',
    description: 'Too deep to wade. A bridge would do it!',
    weight: 0,
    nodeChance: 0,
    nodeResources: [],
    water: 'river',
  },
  {
    // A Wild Isle lake is water (owner answer Q1, 2026-10-24); Cozy's `lake`
    // above stays claimable land. Players see "Lake" on both.
    id: 'wild-lake',
    name: 'Lake',
    description: 'Deep and sparkly. A ferry could cross it!',
    weight: 0,
    nodeChance: 0,
    nodeResources: [],
    water: 'lake',
  },
  {
    // Claimable beach land ringing the island, placed by the generator.
    id: 'coast',
    name: 'Coast',
    description: 'Sand, salt and seabirds. Piers love it here.',
    weight: 0,
    nodeChance: 0,
    nodeResources: [],
  },
];
