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
  {
    id: 'pumpkin-treats',
    name: 'Pumpkin Treats',
    description: 'Turn a pumpkin into a pile of spooky-sweet snacks.',
    inputs: { pumpkins: 1 }, // TUNE:
    output: { resource: 'treats', quantity: 3 }, // TUNE:
    craftSeconds: 30, // TUNE:
    season: 'halloween',
  },
];
