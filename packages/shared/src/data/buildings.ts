import type { Building } from '../schemas/data/buildings.js';

/**
 * Buildings (design doc §13–15). Ids are stored in `buildings` rows: add
 * freely, never rename or remove one. `placement` says where one can stand
 * (#202) and `slot` which spots it takes on a tile (#204).
 */
export const BUILDINGS: Building[] = [
  {
    id: 'hearthfire',
    kind: 'hearthfire',
    name: 'Hearthfire',
    description: 'Keeps squishies out on your land safe from the Hollow Man at night.',
    // #202: on captured land, one a tile, in its middle (#204). Never at
    // home: the Heart Seed keeps home safe (owner decision 2026-10-07).
    placement: 'land',
    maxPerTile: 1, // TUNE:
    slot: 'centre',
    fuelResource: 'emberwood',
    fuelPerNight: 1, // TUNE:
    maxFuelNights: 8, // TUNE: owner decision 2026-10-08 (#277): a full week away, home after 7 PM, keeps every fire lit
    levels: [
      // Radii 1 / 1 / 2 (owner decision 2026-10-08, #277): every bit of land
      // needs a fire's light, so one fire covers less.
      { cost: { timber: 5, stone: 5 }, safeRadius: 1 }, // TUNE:
      { cost: { timber: 10, stone: 10 }, safeRadius: 1 }, // TUNE:
      { cost: { timber: 20, stone: 15, glimmer: 1 }, safeRadius: 2 }, // TUNE: Glimmer 2 → 1 (#277 sim gate margin)
    ],
  },
  {
    // Built from the crafted item (#17's recipe), only around Halloween (§15).
    id: 'jack-o-lantern-hearthfire',
    kind: 'hearthfire',
    name: "Jack-o'-Lantern Hearthfire",
    description: 'A grinning pumpkin fire. Its light keeps the Hollow Man away!',
    season: 'halloween',
    placement: 'land', // like the Hearthfire (owner decision 2026-10-07)
    maxPerTile: 1, // TUNE:
    slot: 'centre',
    // The carved pumpkin was a lot of work: it always comes back whole.
    refundPercent: 100, // TUNE:
    fuelResource: 'emberwood',
    fuelPerNight: 1, // TUNE:
    maxFuelNights: 8, // TUNE: same as a plain Hearthfire
    // TUNE: owner decision 2026-10-08 (#277): lights its ring, like a new Hearthfire.
    levels: [{ cost: { 'jack-o-lantern-hearthfire': 1 }, safeRadius: 1 }],
  },
  {
    id: 'ember-den',
    kind: 'habitat',
    name: 'Ember Den',
    description: 'A warm home. Fire and Cozy squishies grow faster here.',
    maxPerHome: 2, // TUNE:
    placement: 'home',
    slot: 'ring',
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
    description: 'A sunny nap spot. Leaf, Cozy and Sleepy squishies grow faster here.',
    maxPerHome: 2, // TUNE:
    placement: 'home',
    slot: 'ring',
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
    description: 'Squishies practice here and earn XP all by themselves.',
    maxPerHome: 1, // TUNE:
    placement: 'home',
    slot: 'ring',
    levels: [
      { cost: { timber: 8, stone: 8 }, capacity: 2, xpPerHour: 5 }, // TUNE:
      { cost: { timber: 16, stone: 16 }, capacity: 3, xpPerHour: 8 }, // TUNE:
    ],
  },
  // Fences (#203; owner decisions 2026-10-07, second mockup): one per
  // element, made from that element's stuff and weak to whatever beats it
  // in ELEMENT_MATRIX. Every fence has the same energy and toughness at a
  // level, so only the element differs and no fence is simply best.
  {
    id: 'hedge',
    kind: 'fence',
    name: 'Hedge',
    description:
      'A leafy hedge that keeps other Keepers out. Fire and Frost squishies get through it fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'leaf',
    levels: [
      { cost: { greens: 8, timber: 1 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { greens: 10, timber: 2 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { greens: 12, glimmer: 2 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'moat',
    kind: 'fence',
    name: 'Moat',
    description:
      'A splashy moat that keeps other Keepers out. Leaf and Spark squishies cross it fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'water',
    levels: [
      { cost: { water: 8, stone: 2 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { water: 10, stone: 4 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { water: 12, stone: 4, glimmer: 2 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'stone-wall',
    kind: 'fence',
    name: 'Stone Wall',
    description:
      'A sturdy wall that keeps other Keepers out. Water and Leaf squishies wash it away!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'stone',
    levels: [
      { cost: { stone: 8, timber: 3 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { stone: 10, timber: 5 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { stone: 12, timber: 5, glimmer: 2 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'emberwood-palisade',
    kind: 'fence',
    name: 'Emberwood Palisade',
    description:
      'Warm log stakes that keep other Keepers out. Water and Stone squishies topple them fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'fire',
    levels: [
      { cost: { emberwood: 6, timber: 2 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { emberwood: 8, timber: 4 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { emberwood: 10, timber: 4, glimmer: 2 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'glimmer-rail',
    kind: 'fence',
    name: 'Glimmer Rail',
    description:
      'A fizzy rail that keeps other Keepers out. Stone and Shadow squishies fizzle it fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'spark',
    levels: [
      { cost: { glimmer: 2, timber: 4 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { glimmer: 3, timber: 6 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { glimmer: 5, timber: 6 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'lantern-fence',
    kind: 'fence',
    name: 'Lantern Fence',
    description:
      'Glowing lanterns that keep other Keepers out. Spark and Shadow squishies dim them fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'light',
    levels: [
      { cost: { glimmer: 2, timber: 5 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { glimmer: 3, timber: 6, emberwood: 2 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { glimmer: 4, timber: 6, emberwood: 4 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'bramble-hedge',
    kind: 'fence',
    name: 'Bramble Hedge',
    description:
      'A curly purple tangle that keeps other Keepers out. Frost and Light squishies get through it fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'shadow',
    levels: [
      { cost: { greens: 6, emberwood: 3 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { greens: 8, emberwood: 4 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { greens: 8, emberwood: 4, 'witch-dust': 2 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
  {
    id: 'ice-wall',
    kind: 'fence',
    name: 'Ice Wall',
    description:
      'Chunky ice blocks that keep other Keepers out. Fire and Light squishies melt them fast!',
    placement: 'owned',
    slot: 'edge',
    maxPerTile: 6, // one a hex edge
    maxPerHome: 42, // not read for fences: one segment per edge is their only cap
    element: 'frost',
    levels: [
      { cost: { ice: 6, stone: 2 }, hp: 70, defense: 14 }, // TUNE:
      { cost: { ice: 8, stone: 3 }, hp: 100, defense: 18 }, // TUNE:
      { cost: { ice: 10, stone: 3, glimmer: 2 }, hp: 140, defense: 22 }, // TUNE:
    ],
  },
];
