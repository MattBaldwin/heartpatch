import type { Move } from '../../schemas/data/moves.js';
import type { SecretEvolution } from '../../schemas/data/server-game-data.js';
import type { Species } from '../../schemas/data/species.js';

/*
 * Secret squishies, the moves only they know, and evolutions into secret
 * forms (design doc §4, §8). Secret (CLAUDE.md rule 6): server-only. The
 * public species table refuses `rarity: 'secret'`, so secrets always land
 * here. A secret species is sent to a player only once they meet it.
 */

export const SECRET_MOVES: Move[] = [
  // TUNE: placeholder; #10 writes real content
  {
    id: 'placeholder-hush-hum',
    name: 'Hush Hum',
    description: 'A soft, sleepy hum under the moon.',
    element: 'shadow',
    power: 40,
    accuracy: 100,
  },
  // TUNE: placeholder; #10 writes real content
  {
    id: 'placeholder-moon-blink',
    name: 'Moon Blink',
    description: 'A slow, glowy blink that makes it feel extra quick.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 }],
  },
];

export const SECRET_SPECIES: Species[] = [
  // TUNE: placeholder; #10 writes real content
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
  // TUNE: placeholder; #10 writes real content
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
];

export const SECRET_EVOLUTIONS: SecretEvolution[] = [
  // TUNE: placeholder; #10 writes real content
  { from: 'placeholder-moonpuff', into: 'placeholder-moonmallow', level: 20 },
];
