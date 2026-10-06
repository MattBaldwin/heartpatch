import type { Resource } from '../schemas/data/resources.js';

/**
 * Resources from design doc §12, plus crafted items: the Heart Charm (§6) and
 * the Jack-o'-Lantern Hearthfire (§15). `gather` is one gather on a node.
 */
export const RESOURCES: Resource[] = [
  {
    id: 'timber',
    name: 'Timber',
    description: 'Sturdy logs from the forest.',
    kind: 'gathered',
    gather: { seconds: 15 * 60, quantity: 5 }, // TUNE:
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
    description: 'Crunchy leaves with a golden shimmer.',
    kind: 'seasonal',
    season: 'thanksgiving',
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
    id: 'jack-o-lantern-hearthfire',
    name: "Jack-o'-Lantern Hearthfire",
    description: 'A grinning, extra-bright fire. The Hollow Man really does not like it.',
    kind: 'crafted',
  },
];
