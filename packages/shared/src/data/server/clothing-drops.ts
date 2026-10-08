import type { ClothingDropTable } from '../../schemas/data/clothing-drops.js';

/**
 * The #261 Halloween costumes, in every table that finds them: rarer is much
 * rarer, the Mythic rarest of all (weights ×10, so it can be 1). One list, so
 * the ladder can't drift between tables.
 */
const HALLOWEEN_COSTUMES = [
  { item: 'patch-scarecrow', weight: 30 }, // TUNE: every weight
  { item: 'candy-corn-cutie', weight: 30 },
  { item: 'star-striker', weight: 20 },
  { item: 'cozy-mummy', weight: 20 },
  { item: 'moonbroom-witch', weight: 12 },
  { item: 'bat-buddy', weight: 12 },
  { item: 'zippy-hedgehog', weight: 6 },
  { item: 'glow-moth', weight: 6 },
  { item: 'marigold-calavera', weight: 3 },
  { item: 'hollow-man-costume', weight: 1 },
] as const satisfies readonly ClothingDropTable['entries'][number][];

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
      { item: 'pom-pom-beanie', weight: 100 }, // TUNE: every weight (×10 so a Mythic can be 1)
      { item: 'heart-clip', weight: 100 },
      { item: 'cozy-apron', weight: 100 },
      { item: 'squishy-net', weight: 100 },
      { item: 'snuggle-scarf', weight: 100 },
      { item: 'flower-crown', weight: 60, terrains: ['meadow', 'hills'] },
      { item: 'big-bow', weight: 60 },
      { item: 'rainbow-scarf', weight: 60 },
      { item: 'twirly-tutu', weight: 60 },
      { item: 'bubble-wand', weight: 60, terrains: ['lake', 'meadow'] },
      { item: 'tiny-top-hat', weight: 60 },
      { item: 'bunny-slippers', weight: 30 },
      { item: 'cloud-cape', weight: 30, terrains: ['hills', 'mountains'] },
      { item: 'starry-crown', weight: 30 },
      { item: 'butterfly-wings', weight: 10, terrains: ['meadow', 'forest'] },
      { item: 'tiny-crown', weight: 10 },
      { item: 'cloud-onesie', weight: 10 },
      // Halloween window only (catalog `season`).
      { item: 'bat-clip', weight: 100 },
      { item: 'candy-corn-clip', weight: 100 },
      { item: 'witch-hat', weight: 60 },
      { item: 'moonlit-sweater', weight: 60 },
      { item: 'pumpkin-bloomers', weight: 60, terrains: ['pumpkin-fields'] },
      { item: 'jack-o-lamp', weight: 60, terrains: ['pumpkin-fields', 'forest'] },
      { item: 'pumpkin-cap', weight: 60, terrains: ['pumpkin-fields'] },
      { item: 'pumpkin-hood', weight: 30, terrains: ['pumpkin-fields'] },
      { item: 'curly-witch-boots', weight: 30 },
      { item: 'ghost-cape', weight: 30, terrains: ['old-forest', 'forest'] },
      { item: 'tiny-broom', weight: 30 },
      { item: 'tiny-witch-hat', weight: 30 },
      { item: 'ghost-sheet', weight: 30, terrains: ['old-forest'] },
      { item: 'bat-wings', weight: 10, terrains: ['old-forest', 'mountains'] },
      { item: 'squishy-onesie', weight: 10 },
      ...HALLOWEEN_COSTUMES,
    ],
  },
  {
    // Tile captures (#15) roll this table; taking a rival's land finds more (#261).
    source: 'capture',
    chance: 12, // TUNE
    rivalChance: 20, // TUNE
    entries: [
      { item: 'big-bow', weight: 60 },
      { item: 'rainbow-scarf', weight: 60 },
      { item: 'tiny-top-hat', weight: 60 },
      { item: 'starry-crown', weight: 30 },
      { item: 'bunny-slippers', weight: 30 },
      { item: 'butterfly-wings', weight: 10 },
      { item: 'tiny-crown', weight: 10 },
      { item: 'witch-hat', weight: 60 },
      { item: 'curly-witch-boots', weight: 30 },
      { item: 'tiny-witch-hat', weight: 30 },
      { item: 'bat-wings', weight: 10 },
      { item: 'squishy-onesie', weight: 10 },
      ...HALLOWEEN_COSTUMES,
    ],
  },
  {
    // Hollow rescues (#21) roll this table: a little thank-you from the squishy.
    source: 'rescue',
    chance: 20, // TUNE
    entries: [
      { item: 'snuggle-scarf', weight: 100 },
      { item: 'cloud-cape', weight: 30 },
      { item: 'cloud-onesie', weight: 10 },
      { item: 'ghost-cape', weight: 60 },
      { item: 'ghost-sheet', weight: 30 },
      { item: 'jack-o-lamp', weight: 60 },
    ],
  },
  {
    // A won wild battle (#261): only the Halloween costumes so far, so
    // outside the window a win finds nothing.
    source: 'battle',
    chance: 6, // TUNE
    entries: [...HALLOWEEN_COSTUMES],
  },
  {
    // An explore find (#199 calls `rollFoundDrop` with `source: 'explore'`).
    source: 'explore',
    chance: 10, // TUNE
    entries: [...HALLOWEEN_COSTUMES],
  },
];
