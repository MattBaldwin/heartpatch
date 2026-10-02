import type { Resource } from '../schemas/data/resources.js';

/** Resources from design doc §12, plus the craftable Heart Charm (§6). */
export const RESOURCES: Resource[] = [
  { id: 'timber', name: 'Timber', description: 'Sturdy logs from the forest.', kind: 'gathered' },
  {
    id: 'stone',
    name: 'Stone',
    description: 'Good, solid rocks from the hills.',
    kind: 'gathered',
  },
  {
    id: 'emberwood',
    name: 'Emberwood',
    description: 'Old-forest wood that keeps a Hearthfire glowing all night.',
    kind: 'gathered',
  },
  {
    id: 'glimmer',
    name: 'Glimmer',
    description: 'Twinkly bits found in mountains and caves.',
    kind: 'gathered',
  },
  {
    id: 'heartdust',
    name: 'Heartdust',
    description: 'Rare, sparkly dust left over from a happy rescue.',
    kind: 'gathered',
  },
  { id: 'treats', name: 'Treats', description: 'Yummy snacks squishies adore.', kind: 'gathered' },
  {
    id: 'pumpkins',
    name: 'Pumpkins',
    description: 'Round, orange and grinning a little.',
    kind: 'seasonal',
    season: 'halloween',
  },
  {
    id: 'witch-dust',
    name: 'Witch Dust',
    description: 'Glittery purple dust that shows up at dusk.',
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
    description: 'Fluffy feathers in every autumn colour.',
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
];
