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
      'Cool, clear water from a lakeside well. Leave it out in the cold at home to freeze it into Ice!',
    kind: 'gathered',
    gather: { seconds: 20 * 60, quantity: 3 }, // TUNE: like Treats
  },
  {
    id: 'greens',
    name: 'Greens',
    description:
      'Leafy bundles of grass and clover from meadows and forests, for growing leafy things.',
    kind: 'gathered',
    gather: { seconds: 15 * 60, quantity: 4 }, // TUNE: a little less than Stone
  },
  {
    id: 'ice',
    name: 'Ice',
    description:
      'Chilly chunks from the mountains, for building frosty things. They never melt in your bag!',
    kind: 'gathered',
    gather: { seconds: 30 * 60, quantity: 2 }, // TUNE: like Emberwood
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
    description: 'A carved, grinning pumpkin. Build it into a Hearthfire at home!',
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
    description: 'A big bowl of yum that brings back lots of energy.',
    kind: 'crafted',
    battleEffect: { healPercent: 40, shieldPercent: 75 }, // TUNE:
  },
];
