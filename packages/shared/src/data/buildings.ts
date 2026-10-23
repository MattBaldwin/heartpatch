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
    // Rekindled (#306 PR 5): built from the crafted kit, whose recipe page
    // opens only with a Joy Ember found in a Hollowed village. A stronger
    // fire: its light reaches a tile past its ring, like a top-level
    // Hearthfire, from the start.
    id: 'joy-lantern',
    kind: 'hearthfire',
    name: 'Joy Lantern',
    description: 'A happy heart flame. Its light reaches one tile further than a new Hearthfire!',
    placement: 'land', // like every Hearthfire (owner decision 2026-10-07)
    maxPerTile: 1, // TUNE:
    slot: 'centre',
    // The Joy Ember was a lucky find: the kit always comes back whole.
    refundPercent: 100, // TUNE:
    fuelResource: 'emberwood',
    fuelPerNight: 1, // TUNE:
    maxFuelNights: 8, // TUNE: same as a plain Hearthfire
    levels: [{ cost: { 'joy-lantern': 1 }, safeRadius: 2 }], // TUNE: a Hearthfire's level 3 light
  },
  {
    id: 'ember-den',
    kind: 'habitat',
    name: 'Ember Den',
    description: 'A warm home. Fire and Cozy squishies grow faster here.',
    maxPerHome: 4, // TUNE: owner 2026-10-18 (#537); one building a tile still bounds the total
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
    maxPerHome: 4, // TUNE: owner 2026-10-18 (#537); one building a tile still bounds the total
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
    // On a homestead only (owner decision 4 on #277): trainees sleep out
    // there, so they need a fire's light like a gatherer.
    placement: 'homestead',
    maxPerTile: 1, // TUNE:
    slot: 'ring',
    levels: [
      { cost: { timber: 8, stone: 8 }, capacity: 2, xpPerHour: 5 }, // TUNE:
      { cost: { timber: 16, stone: 16 }, capacity: 3, xpPerHour: 8 }, // TUNE:
    ],
  },
  {
    // #294 (owner decision 2026-10-08): batches of the pot's recipes that
    // go on while the kid is away. Home is always safe, so nothing stops them.
    id: 'crafting-factory',
    kind: 'factory',
    name: 'Crafting Factory',
    description: "Makes lots of things at once, even while you're away!",
    maxPerHome: 1, // one per player per patch, home or homestead
    // A homestead building (#295, owner decision 2026-10-11): one building a
    // tile, so it moved off the crowded home base.
    placement: 'homestead',
    maxPerTile: 1,
    slot: 'ring',
    // Costs from the #294 mockup (`pnpm sim:factory`): a casual kid builds
    // level 1 in their first week and level 2 (no Glimmer, owner decision
    // 2026-10-08) around day 6, guarded by day 10; Glimmer paces level 3.
    levels: [
      { cost: { timber: 30, stone: 20 }, queues: 2 }, // TUNE:
      { cost: { timber: 60, stone: 50 }, queues: 3 }, // TUNE:
      { cost: { timber: 120, stone: 90, glimmer: 12 }, queues: 4 }, // TUNE:
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
  // Resource buildings (#601, owner decisions 2026-10-22): one for each
  // land, standing on a homestead tile of that land (or land cleared from
  // it). Each works by itself at 3–4× a squishy gatherer's pace and holds
  // a day or more of output. Upkeep is about a fifth of what a day's output
  // sells for (`pnpm sim:patch-economy` guards it). Buildable since their
  // client (PR 7) put `resource` in `HOME_BASE_RULES.buildableKinds`.
  {
    id: 'woodcutters-hut',
    kind: 'resource',
    name: "Woodcutter's Hut",
    description: 'Chops Timber all by itself, much faster than a squishy!',
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'forest',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 17 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 20 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 23,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 23,
      }, // TUNE:
    ],
  },
  {
    id: 'ember-kiln',
    kind: 'resource',
    name: 'Ember Kiln',
    description: 'Bakes warm Emberwood all by itself, much faster than a squishy!',
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'old-forest',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 10 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 11 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 13,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 13,
      }, // TUNE:
    ],
  },
  {
    id: 'stone-quarry',
    kind: 'resource',
    name: 'Stone Quarry',
    description: 'Digs Stone all by itself, much faster than a squishy!',
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'hills',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 17 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 20 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 23,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 23,
      }, // TUNE:
    ],
  },
  {
    id: 'ice-cutter',
    kind: 'resource',
    name: 'Ice Cutter',
    description: 'Saws Ice all by itself, much faster than a squishy!',
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'mountains',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 14 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 17 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 19,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 19,
      }, // TUNE:
    ],
  },
  {
    id: 'water-well',
    kind: 'resource',
    name: 'Water Well',
    description: 'Draws Water all by itself, much faster than a squishy!',
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'lake',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 17 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 20 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 23,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 23,
      }, // TUNE:
    ],
  },
  {
    id: 'greenhouse',
    kind: 'resource',
    name: 'Greenhouse',
    description: 'Grows Greens all by itself, much faster than a squishy!',
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'meadow',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 17 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 20 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 23,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 23,
      }, // TUNE:
    ],
  },
  {
    id: 'pumpkin-barn',
    kind: 'resource',
    name: 'Pumpkin Barn',
    description: 'Grows Pumpkins all by itself around Halloween!',
    season: 'halloween', // built around Halloween only; one built stays (dormant out of season)
    placement: 'homestead',
    maxPerTile: 1, // it fills its tile
    slot: 'ring',
    terrain: 'pumpkin-fields',
    levels: [
      { cost: { timber: 20, stone: 15 }, pacePercent: 300, storageHours: 24, upkeep: 14 }, // TUNE:
      { cost: { timber: 40, stone: 30 }, pacePercent: 350, storageHours: 48, upkeep: 17 }, // TUNE:
      {
        cost: { timber: 80, stone: 60, glimmer: 4 },
        pacePercent: 400,
        storageHours: 72,
        upkeep: 19,
      }, // TUNE:
      {
        cost: { timber: 120, stone: 90, glimmer: 10 },
        pacePercent: 400,
        storageHours: 96,
        upkeep: 19,
      }, // TUNE:
    ],
  },
  {
    // #601: with one paid and standing, level 3+ resource buildings deliver
    // straight to the bag and never fill up. Costly to build on purpose. A
    // month of its upkeep is about what one 5-day trip's saved output is
    // worth at sell price; the daily sell cap means it isn't cashed
    // (`pnpm sim:patch-economy`).
    id: 'warehouse',
    kind: 'warehouse',
    name: 'Warehouse',
    description: 'Your best resource buildings send everything straight to your bag!',
    maxPerHome: 1, // one per player per patch
    placement: 'homestead',
    maxPerTile: 1,
    slot: 'ring',
    levels: [{ cost: { timber: 600, stone: 450, glimmer: 20 }, upkeep: 20 }], // TUNE:
  },
];
