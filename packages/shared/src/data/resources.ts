import type { Resource } from '../schemas/data/resources.js';

/**
 * Resources from design doc §12, plus crafted items: the Heart Charm (§6),
 * the Jack-o'-Lantern Hearthfire (§15) and the battle potions (#214).
 * `gather` is one gather on a node.
 */
export const RESOURCES: Resource[] = [
  {
    id: 'timber',
    name: 'Timber',
    description: 'Sturdy logs from the forest.',
    kind: 'gathered',
    // TUNE: around Thanksgiving, a few Magic Fallen Leaves come down with the logs.
    gather: {
      seconds: 15 * 60,
      quantity: 5,
      extras: [{ resource: 'magic-fallen-leaves', quantity: 1 }],
    },
  },
  {
    id: 'stone',
    name: 'Stone',
    description: 'Good, solid rocks from the hills.',
    kind: 'gathered',
    gather: { seconds: 15 * 60, quantity: 5 }, // TUNE:
  },
  {
    id: 'emberwood',
    name: 'Emberwood',
    description: 'Old-forest wood that keeps a Hearthfire glowing all night.',
    kind: 'gathered',
    // TUNE: one gather is a night of fuel or two; Witch Dust turns up around Halloween.
    gather: { seconds: 30 * 60, quantity: 2, extras: [{ resource: 'witch-dust', quantity: 1 }] },
  },
  {
    id: 'glimmer',
    name: 'Glimmer',
    description: 'Twinkly bits found in mountains and caves.',
    kind: 'gathered',
    gather: { seconds: 60 * 60, quantity: 1 }, // TUNE: rarer than Stone
  },
  // #238: new things to gather, for the element fences (#203).
  {
    id: 'water',
    name: 'Water',
    description:
      'Cool, clear water from a lakeside well. Build a Moat with it, or freeze it into Ice at home!',
    kind: 'gathered',
    gather: { seconds: 20 * 60, quantity: 3 }, // TUNE: like Treats
  },
  {
    id: 'greens',
    name: 'Greens',
    description:
      'Leafy bundles of grass and clover from meadows and forests. Grow a Hedge, or stir them into yummy Treats!',
    kind: 'gathered',
    gather: { seconds: 15 * 60, quantity: 4 }, // TUNE: a little less than Stone
  },
  {
    id: 'ice',
    name: 'Ice',
    description:
      'Cold and sparkly chunks from the mountains, for building an Ice Wall. They never melt in your bag!',
    kind: 'gathered',
    gather: { seconds: 30 * 60, quantity: 2 }, // TUNE: like Emberwood
  },
  // Wild Isle (#621 W1-8): the water works' makes. Fish come from the coast
  // (a squishy can fish by hand; a Fishing Pier is the real way), Salt from
  // the Salt Pans, Flour from a Watermill grinding Greens.
  {
    id: 'fish',
    name: 'Fish',
    description: 'Wiggly, shiny fish from the coast. A Fishing Pier catches lots!',
    kind: 'gathered',
    gather: { seconds: 30 * 60, quantity: 2 }, // TUNE: like Ice
  },
  {
    id: 'flour',
    name: 'Flour',
    description: 'Soft, powdery Flour, ground from Greens by a Watermill.',
    kind: 'crafted',
  },
  {
    id: 'salt',
    name: 'Salt',
    description: 'Crunchy sea Salt, dried in the sun at the Salt Pans.',
    kind: 'gathered',
  },
  {
    id: 'heartdust',
    name: 'Heartdust',
    description: 'Rare, sparkly dust left over from a happy rescue.',
    kind: 'gathered',
  },
  {
    id: 'treats',
    name: 'Treats',
    description: 'Yummy snacks squishies adore, grown on farm plots.',
    kind: 'gathered',
    gather: { seconds: 20 * 60, quantity: 3 }, // TUNE:
  },
  {
    id: 'pumpkins',
    name: 'Pumpkins',
    description: 'Round, orange and grinning a little.',
    kind: 'seasonal',
    season: 'halloween',
    // TUNE: pumpkin patches sparkle with Witch Dust too.
    gather: { seconds: 20 * 60, quantity: 2, extras: [{ resource: 'witch-dust', quantity: 1 }] },
  },
  {
    id: 'witch-dust',
    name: 'Witch Dust',
    description: 'Glittery purple dust you find with Emberwood and Pumpkins.',
    kind: 'seasonal',
    season: 'halloween',
  },
  {
    id: 'magic-fallen-leaves',
    name: 'Magic Fallen Leaves',
    description:
      'Crunchy leaves with a golden shimmer. They pile up at home and tumble down with Timber.',
    kind: 'seasonal',
    season: 'thanksgiving',
    gather: { seconds: 20 * 60, quantity: 3 }, // TUNE: a home leaf pile, like the farm plot
  },
  {
    id: 'turkey-feathers',
    name: 'Turkey Feathers',
    description: 'Fluffy feathers in every autumn color.',
    kind: 'seasonal',
    season: 'thanksgiving',
  },
  {
    id: 'presents',
    name: 'Presents',
    description: 'Wrapped surprises. What could be inside?',
    kind: 'seasonal',
    season: 'christmas',
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    description: 'Big, bright and very loud. Great for a party!',
    kind: 'seasonal',
    season: 'new-year',
  },
  {
    id: 'heart-charm',
    name: 'Heart Charm',
    description: 'Helps a wild squishy feel safe enough to join you.',
    kind: 'crafted',
  },
  {
    // The carved pumpkin you build a Jack-o'-Lantern Hearthfire from. Its id
    // stays (bags hold it); only the name differs from the building's, so
    // the build sheet doesn't read "to build X you need X".
    id: 'jack-o-lantern-hearthfire',
    name: "Jack-o'-Lantern",
    description: 'A carved, grinning pumpkin. Build it into a Hearthfire out on your land!',
    kind: 'crafted',
  },
  // Battle potions (#214, owner decisions 2026-10-07): drinking one takes the
  // squishy's turn, and the next bump it takes is 75% softer, so a potion is
  // never wasted against a much stronger rare squishy.
  {
    id: 'brave-brew',
    name: 'Brave Brew',
    description: 'A fizzy, peppery sip. Your squishy plays bolder for the whole battle!',
    kind: 'crafted',
    battleEffect: { attackPercent: 40, shieldPercent: 75 }, // TUNE: owner decision 2026-10-07
  },
  {
    id: 'cozy-cocoa',
    name: 'Cozy Cocoa',
    description: 'Warm and marshmallowy. Bumps feel extra soft for the whole battle!',
    kind: 'crafted',
    battleEffect: { defensePercent: 40, shieldPercent: 75 }, // TUNE: owner decision 2026-10-07
  },
  {
    id: 'hearty-soup',
    name: 'Hearty Soup',
    description: 'A big bowl of yum. Sip it in a battle to get lots of energy back!',
    kind: 'crafted',
    battleEffect: { healPercent: 40, shieldPercent: 75 }, // TUNE:
  },
  // Rekindled (#306 PR 5): found only in Hollowed villages (the server-only
  // `data/server/hollowed-finds.ts`). Each is the sealed ingredient of a Rekindled recipe, so
  // finding one opens its recipe book page; they stay with their Keeper, so
  // a page is only ever opened by finding it.
  {
    id: 'joy-ember',
    name: 'Joy Ember',
    description: 'A warm little spark of joy, found glowing in a Hollow.',
    kind: 'gathered',
    tradable: false,
  },
  {
    id: 'heart-petals',
    name: 'Heart Petals',
    description: 'Soft pink petals that bloom again when a Hollow gets happy.',
    kind: 'gathered',
    tradable: false,
  },
  {
    // The crafted lantern you build a Joy Lantern from (like the carved
    // Jack-o'-Lantern): its own name, so the build sheet reads well.
    id: 'joy-lantern',
    name: 'Joy Lantern Kit',
    description: 'Everything a Joy Lantern needs. Build it out on your land!',
    kind: 'crafted',
  },
  {
    id: 'heart-tea',
    name: 'Heart Tea',
    description: 'A warm cup of petal tea. Sip, sip, smile!',
    kind: 'crafted',
  },
  // Explore tools (#199): the bag counts each in uses (`EXPLORE_RULES.tools`).
  {
    id: 'shovel',
    name: 'Shovel',
    description: 'Dig up soft mounds while you explore your land.',
    kind: 'crafted',
    tool: 'shovel',
    tradable: false, // #271: worn in uses, it stays with its Keeper
  },
  {
    id: 'net', // #335: the Snorkel, renamed in place (the id stays, so bags keep their uses)
    name: 'Snorkel',
    description: 'Dive under the lake to find what hides in the water.',
    kind: 'crafted',
    tool: 'net',
    tradable: false, // #271: worn in uses, it stays with its Keeper
  },
  {
    id: 'rope', // #335: the Walking Stick, renamed in place (the id stays, so bags keep their uses)
    name: 'Walking Stick',
    description: 'Hike up the mountain trail to the lookouts.',
    kind: 'crafted',
    tool: 'rope',
    tradable: false, // #271: worn in uses, it stays with its Keeper
  },
  {
    id: 'lantern',
    name: 'Lantern',
    description: 'Light up dark caves to see what hides inside.',
    kind: 'crafted',
    tool: 'lantern',
    tradable: false, // #271: worn in uses, it stays with its Keeper
  },
  // Clearing tools (#242, owner decision 2026-10-11 Q4): worn in uses like
  // the explore tools (`CLEARING_RULES.tools`); each clear spends one.
  {
    id: 'axe',
    name: 'Axe',
    description: 'Clears a forest or old forest on your homestead, ready to build on.',
    kind: 'crafted',
    clearTool: 'axe',
    tradable: false, // worn in uses, it stays with its Keeper
  },
  {
    id: 'pickaxe',
    name: 'Pickaxe',
    description: 'Clears a mountain on your homestead, ready to build on.',
    kind: 'crafted',
    clearTool: 'pickaxe',
    tradable: false, // worn in uses, it stays with its Keeper
  },
  {
    id: 'spade',
    name: 'Spade',
    description:
      'Clears a meadow, hill, lake or pumpkin field on your homestead, ready to build on.',
    kind: 'crafted',
    clearTool: 'spade',
    tradable: false, // worn in uses, it stays with its Keeper
  },
];
