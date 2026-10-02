import type { Move } from '../../schemas/data/moves.js';
import type { SecretEvolution } from '../../schemas/data/server-game-data.js';
import type { Species } from '../../schemas/data/species.js';

/*
 * Secret squishies, the moves only they know, and evolutions into secret
 * forms (design doc §4, §8). Secret (CLAUDE.md rule 6): server-only. The
 * public species table refuses `rarity: 'secret'`, so secrets always land
 * here. A secret species is sent to a player only once they meet it.
 *
 * The `placeholder-*` rows come first and stay until the tests that use
 * them move to the roster (a follow-up to #10); the launch secret comes
 * after them.
 */

export const SECRET_MOVES: Move[] = [
  // TUNE: placeholder, kept for tests
  {
    id: 'placeholder-hush-hum',
    name: 'Hush Hum',
    description: 'A soft, sleepy hum under the moon.',
    element: 'shadow',
    power: 40,
    accuracy: 100,
  },
  // TUNE: placeholder, kept for tests
  {
    id: 'placeholder-moon-blink',
    name: 'Moon Blink',
    description: 'A slow, glowy blink that makes it feel extra quick.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 }],
  },
  // Only Heartlet's line knows it, so naming it publicly would give it away.
  {
    id: 'heart-glow',
    name: 'Heart Glow',
    description: 'A warm, pink glow from deep inside. Everyone feels a little better.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'heal', percent: 40 }, // TUNE:
      { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 100 }, // TUNE:
    ],
  },
];

export const SECRET_SPECIES: Species[] = [
  // TUNE: placeholder, kept for tests
  {
    id: 'placeholder-moonpuff',
    name: 'Moonpuff',
    description: 'A tiny puff that only comes out when the moon is just right.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'secret',
    baseStats: { hp: 50, attack: 40, defense: 45, speed: 60 },
    moves: ['placeholder-hush-hum', 'placeholder-moon-blink'],
    evolutions: [],
    visual: { body: 'blob', palette: ['#3b3561', '#f5e6a8'], parts: ['sleepy-eyes', 'tiny-smile'] },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
  },
  // TUNE: placeholder, kept for tests
  {
    id: 'placeholder-moonmallow',
    name: 'Moonmallow',
    description: 'Moonpuff, all grown up and glowing softly.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'secret',
    baseStats: { hp: 75, attack: 60, defense: 65, speed: 80 },
    moves: ['placeholder-hush-hum', 'placeholder-moon-blink'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#3b3561', '#f5e6a8', '#c9b8ff'],
      parts: ['sleepy-eyes', 'tiny-smile', 'nub-wings'],
      size: 1.2,
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
  },
  // Light + Cozy. A tiny piece of the Heartpatch that never quite scattered
  // (design doc §2); it wanders Juniper's Gap on quiet nights (spawn table
  // `gap-nights`).
  {
    id: 'heartlet',
    name: 'Heartlet',
    description: 'A tiny, glowing piece of the Heartpatch. It hums when it is happy.',
    element: 'light',
    feeling: 'cozy',
    rarity: 'secret',
    baseStats: { hp: 65, attack: 55, defense: 65, speed: 60 }, // TUNE:
    moves: ['sunny-beam', 'cozy-crackle', 'heart-glow'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#ffc2d6', '#fff6f9', '#ff7aa2', '#ffe066'],
      parts: ['happy-eyes', 'tiny-smile', 'blush-cheeks', 'nub-wings'],
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'joy'] },
  },
  {
    id: 'heartbloom',
    name: 'Heartbloom',
    description: 'A Heartlet in full bloom. Little flowers pop up wherever it naps.',
    element: 'light',
    feeling: 'cozy',
    rarity: 'secret',
    baseStats: { hp: 90, attack: 80, defense: 90, speed: 85 }, // TUNE:
    moves: ['sunny-beam', 'cozy-crackle', 'heart-glow', 'night-light'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#ffadc8', '#fff6f9', '#ff5c8f', '#ffd23f'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'nub-wings', 'leaf-sprout', 'freckles'],
      size: 1.3,
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'joy'] },
  },
];

export const SECRET_EVOLUTIONS: SecretEvolution[] = [
  // TUNE: placeholder, kept for tests
  { from: 'placeholder-moonpuff', into: 'placeholder-moonmallow', level: 20 },
  { from: 'heartlet', into: 'heartbloom', level: 25 }, // TUNE:
];
