import type { Species } from '../schemas/data/species.js';

/*
 * Wave 3: the Clockwork Isle tech squishies (#874, Wave 1 lane C6). Two
 * common kinds, named by the owner (DECISIONS "Supervisor 55", answer 11) and
 * drawn to the owner-approved M4 frames (captures-874-clockwork
 * mockups-r4-64e8e031): Gearbit, a brass toy with gear ears that spin when
 * it's happy and a wind-up key on its back; Bulbun, a bunny with a soft bulb
 * nose that glows at dusk. The frames' scarves are a Wardrobe accessory
 * (answer 12), not part of either look, so no scarf part lives here.
 *
 * Each line is baby → kid for now (#443): the kid keeps its kind's rarity and
 * evolves at the common kid level, so a Wave 2 teen can join after it at kid
 * level + 8 without changing these rows. Isle-only: they spawn only in the
 * server's `clockwork-*` spawn tables (`patchTypes: ['clockwork-isle']`).
 * Public data like the rest of `species.ts`; where each one spawns is
 * server-only.
 *
 * Stat budgets follow the launch bands in `species.ts` (TUNE: every
 * `baseStats`): common 195-215; a kid is ×1.18 its kind. Every move comes
 * from the existing `MOVES`.
 */
export const WAVE_3_SPECIES: Species[] = [
  // Gearbit line: baby, kid.
  {
    id: 'gearbit',
    name: 'Gearbit',
    description: 'A little brass tinker toy. Its gear ears spin round and round when it is happy.',
    element: 'spark',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 50, attack: 50, defense: 45, speed: 60 }, // TUNE:
    moves: ['zip-zap', 'static-glide', 'zoomies'],
    evolutions: [{ into: 'cogwhirl', level: 16 }], // TUNE: #443 kid at the common level
    visual: {
      body: 'orb',
      palette: ['#e0a94a', '#f6dfb0', '#c8743a', '#8a5a2b'],
      parts: [
        'close-happy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'gear-ears',
        'stubby-arms',
        'stubby-legs',
        'windup-key',
      ],
      pose: 'stand',
      attackPart: 'ears',
      size: 0.9,
    },
    habitatPreferences: { elements: ['spark'], feelings: ['joy', 'silly'] },
  },
  {
    id: 'cogwhirl',
    name: 'Cogwhirl',
    description:
      'A ring of tiny cogs popped up on its head. Wind its key and it twirls a happy jig.',
    element: 'spark',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 59, attack: 59, defense: 53, speed: 71 }, // TUNE: ×1.18 Gearbit
    moves: ['zip-zap', 'static-glide', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#e0a94a', '#f6dfb0', '#c8743a', '#8a5a2b'],
      parts: [
        'close-happy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'gear-ears',
        'stubby-arms',
        'stubby-legs',
        'windup-key',
        'cog-crown',
      ],
      pose: 'stand',
      attackPart: 'ears',
      size: 1.1,
    },
    habitatPreferences: { elements: ['spark'], feelings: ['joy', 'silly'] },
  },

  // Bulbun line: baby, kid.
  {
    id: 'bulbun',
    name: 'Bulbun',
    description: 'A soft bunny with a glass bulb nose. When the sun goes down, its nose glows.',
    element: 'light',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 58, attack: 45, defense: 52, speed: 50 }, // TUNE:
    moves: ['sunny-beam', 'night-light', 'night-light-hug'],
    evolutions: [{ into: 'lanternbun', level: 16 }], // TUNE: #443 kid at the common level
    visual: {
      body: 'bun',
      palette: ['#ebe4ff', '#ffffff', '#ffd65c', '#c7b6f5'],
      parts: [
        'oval-eyes',
        'tiny-smile',
        'blush-cheeks',
        'long-ears',
        'bulb-nose',
        'round-hands',
        'hop-feet',
        'ball-tail',
      ],
      glow: 'body',
      pose: 'sit',
      attackPart: 'ears',
      size: 1,
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'sleepy'] },
  },
  {
    id: 'lanternbun',
    name: 'Lanternbun',
    description: 'Fluffier now, with a snug fur collar. Its bulb nose lights the way home.',
    element: 'light',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 68, attack: 53, defense: 61, speed: 59 }, // TUNE: ×1.18 Bulbun
    moves: ['sunny-beam', 'night-light', 'night-light-hug'],
    evolutions: [],
    visual: {
      body: 'bun',
      palette: ['#ebe4ff', '#ffffff', '#ffd65c', '#c7b6f5'],
      parts: [
        'oval-eyes',
        'tiny-smile',
        'blush-cheeks',
        'long-ears',
        'bulb-nose',
        'round-hands',
        'hop-feet',
        'fluff-tail',
        'fur-ruff',
      ],
      glow: 'body',
      pose: 'sit',
      attackPart: 'ears',
      size: 1.2,
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'sleepy'] },
  },
];
