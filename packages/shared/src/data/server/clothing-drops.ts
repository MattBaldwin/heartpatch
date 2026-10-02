import type { ClothingDropTable } from '../../schemas/data/clothing-drops.js';

/**
 * Found clothing drop tables (design doc §23). Secret (CLAUDE.md rule 6):
 * server-only, so players can't read the odds or where things hide. Halloween
 * items carry `season: 'halloween'` in the catalog and only drop in that
 * window. Rarer items get smaller weights. All first guesses.
 */
export const CLOTHING_DROPS: ClothingDropTable[] = [
  {
    source: 'gather',
    chance: 8, // TUNE: about one find every dozen gathers
    entries: [
      { item: 'pom-pom-beanie', weight: 10 }, // TUNE: every weight
      { item: 'heart-clip', weight: 10 },
      { item: 'cozy-apron', weight: 10 },
      { item: 'squishy-net', weight: 10 },
      { item: 'snuggle-scarf', weight: 10 },
      { item: 'flower-crown', weight: 6, terrains: ['meadow', 'hills'] },
      { item: 'big-bow', weight: 6 },
      { item: 'rainbow-scarf', weight: 6 },
      { item: 'twirly-tutu', weight: 6 },
      { item: 'bubble-wand', weight: 6, terrains: ['lake', 'meadow'] },
      { item: 'tiny-top-hat', weight: 6 },
      { item: 'bunny-slippers', weight: 3 },
      { item: 'cloud-cape', weight: 3, terrains: ['hills', 'mountains'] },
      { item: 'starry-crown', weight: 3 },
      { item: 'butterfly-wings', weight: 1, terrains: ['meadow', 'forest'] },
      { item: 'tiny-crown', weight: 1 },
      { item: 'cloud-onesie', weight: 1 },
      // Halloween window only (catalog `season`).
      { item: 'bat-clip', weight: 10 },
      { item: 'candy-corn-clip', weight: 10 },
      { item: 'witch-hat', weight: 6 },
      { item: 'moonlit-sweater', weight: 6 },
      { item: 'pumpkin-bloomers', weight: 6, terrains: ['pumpkin-fields'] },
      { item: 'jack-o-lamp', weight: 6, terrains: ['pumpkin-fields', 'forest'] },
      { item: 'pumpkin-cap', weight: 6, terrains: ['pumpkin-fields'] },
      { item: 'pumpkin-hood', weight: 3, terrains: ['pumpkin-fields'] },
      { item: 'curly-witch-boots', weight: 3 },
      { item: 'ghost-cape', weight: 3, terrains: ['old-forest', 'forest'] },
      { item: 'tiny-broom', weight: 3 },
      { item: 'tiny-witch-hat', weight: 3 },
      { item: 'ghost-sheet', weight: 3, terrains: ['old-forest'] },
      { item: 'bat-wings', weight: 1, terrains: ['old-forest', 'mountains'] },
      { item: 'squishy-onesie', weight: 1 },
    ],
  },
  {
    // Tile captures (#15) roll this table.
    source: 'capture',
    chance: 12, // TUNE
    entries: [
      { item: 'big-bow', weight: 6 },
      { item: 'rainbow-scarf', weight: 6 },
      { item: 'tiny-top-hat', weight: 6 },
      { item: 'starry-crown', weight: 3 },
      { item: 'bunny-slippers', weight: 3 },
      { item: 'butterfly-wings', weight: 1 },
      { item: 'tiny-crown', weight: 1 },
      { item: 'witch-hat', weight: 6 },
      { item: 'curly-witch-boots', weight: 3 },
      { item: 'tiny-witch-hat', weight: 3 },
      { item: 'bat-wings', weight: 1 },
      { item: 'squishy-onesie', weight: 1 },
    ],
  },
  {
    // Hollow rescues (#21) roll this table: a little thank-you from the squishy.
    source: 'rescue',
    chance: 20, // TUNE
    entries: [
      { item: 'snuggle-scarf', weight: 10 },
      { item: 'cloud-cape', weight: 3 },
      { item: 'cloud-onesie', weight: 1 },
      { item: 'ghost-cape', weight: 6 },
      { item: 'ghost-sheet', weight: 3 },
      { item: 'jack-o-lamp', weight: 6 },
    ],
  },
];
