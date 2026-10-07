import type { Recipe } from '../schemas/data/recipes.js';

export const RECIPES: Recipe[] = [
  {
    id: 'heart-charm',
    name: 'Heart Charm',
    description: 'A little charm to help you befriend a wild squishy.',
    inputs: { timber: 2, treats: 1 }, // TUNE:
    output: { resource: 'heart-charm', quantity: 1 },
    craftSeconds: 60, // TUNE:
  },
  // Battle potions (#214): farm Treats plus something gathered. Year-round
  // inputs, so a potion never needs a season.
  {
    id: 'brave-brew',
    name: 'Brave Brew',
    description: 'Stir Treats and a pinch of Stone into a fizzy, peppery brew.',
    inputs: { treats: 2, stone: 2 }, // TUNE:
    output: { resource: 'brave-brew', quantity: 1 },
    craftSeconds: 2 * 60, // TUNE:
  },
  {
    id: 'cozy-cocoa',
    name: 'Cozy Cocoa',
    description: 'Warm Treats over a little Timber fire. Marshmallows on top!',
    inputs: { treats: 2, timber: 2 }, // TUNE:
    output: { resource: 'cozy-cocoa', quantity: 1 },
    craftSeconds: 2 * 60, // TUNE:
  },
  {
    id: 'hearty-soup',
    name: 'Hearty Soup',
    description: 'Simmer Treats on Emberwood until it smells amazing.',
    inputs: { treats: 2, emberwood: 1 }, // TUNE:
    output: { resource: 'hearty-soup', quantity: 1 },
    craftSeconds: 2 * 60, // TUNE:
  },
  {
    id: 'pumpkin-treats',
    name: 'Pumpkin Treats',
    description: 'Turn a pumpkin into a pile of spooky-sweet snacks.',
    inputs: { pumpkins: 1 }, // TUNE:
    output: { resource: 'treats', quantity: 3 }, // TUNE:
    craftSeconds: 30, // TUNE:
    season: 'halloween',
  },
  {
    id: 'jack-o-lantern-hearthfire',
    name: "Jack-o'-Lantern",
    description:
      'Carve a big pumpkin with a glowing grin. Then build it into a fire out on your land. Boo!',
    inputs: { pumpkins: 3, emberwood: 2, 'witch-dust': 1 }, // TUNE:
    output: { resource: 'jack-o-lantern-hearthfire', quantity: 1 }, // built at home (#18)
    craftSeconds: 5 * 60, // TUNE:
    season: 'halloween',
  },
  {
    // Thanksgiving's use for Magic Fallen Leaves (owner decision 2026-10-06):
    // cheaper Heart Charms while the season's squishy is out.
    id: 'leafy-heart-charms',
    name: 'Leafy Heart Charms',
    description:
      'Make two Heart Charms wrapped in crunchy golden leaves. Squishies love the crinkle!',
    inputs: { 'magic-fallen-leaves': 4, treats: 1 }, // TUNE:
    output: { resource: 'heart-charm', quantity: 2 }, // TUNE:
    craftSeconds: 60, // TUNE: same as a plain Heart Charm
    season: 'thanksgiving',
  },
];
