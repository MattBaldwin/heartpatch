/**
 * TEST FIXTURES ONLY. Never shipped and never exported from the package.
 * Just enough species, moves and spawn tables to exercise the schemas; the
 * real launch roster arrives with issue #10.
 */
import type { SpawnTable } from '../../src/data/server/index.js';
import type { Move, Species } from '../../src/index.js';
import type { SecretEvolution } from '../../src/schemas/data/server-game-data.js';

export const FIXTURE_MOVES: Move[] = [
  {
    id: 'fixture-giggle-drizzle',
    name: 'Giggle Drizzle',
    description: 'A sprinkle of giggly rain.',
    element: 'water',
    power: 40,
    accuracy: 100,
  },
  {
    id: 'fixture-belly-flop',
    name: 'Belly Flop',
    description: 'A big, bouncy splash landing.',
    element: 'water',
    power: 60,
    accuracy: 90,
    effects: [{ type: 'status', status: 'dizzy', chance: 20 }],
  },
  {
    id: 'fixture-rock-a-bye',
    name: 'Rock-a-Bye',
    description: 'A gentle lullaby that makes everyone yawn.',
    element: 'stone',
    power: 0,
    accuracy: 85,
    effects: [{ type: 'status', status: 'sleepy', chance: 60 }],
  },
  {
    id: 'fixture-pebble-puff',
    name: 'Pebble Puff',
    description: 'Puffs up big and rolls right over.',
    element: 'stone',
    power: 50,
    accuracy: 95,
    effects: [{ type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 100 }],
  },
  // Battle engine fixtures (#11): one of each effect, always landing, so
  // tests can predict exactly what happens.
  {
    id: 'fixture-tickle-tackle',
    name: 'Tickle Tackle',
    description: 'A warm, wiggly tickle. Hee hee!',
    element: 'fire',
    power: 70,
    accuracy: 100,
  },
  {
    id: 'fixture-cuddle-nap',
    name: 'Cuddle Nap',
    description: 'A quick cuddle to get some energy back.',
    element: 'fire',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 50 }],
  },
  {
    id: 'fixture-zippy-zoom',
    name: 'Zippy Zoom',
    description: 'Zooms in circles and gets even zippier.',
    element: 'fire',
    power: 30,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 2, chance: 100 }],
  },
  {
    id: 'fixture-silly-face',
    name: 'Silly Face',
    description: 'A face so silly the other squishy forgets to try.',
    element: 'leaf',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'attack', stages: -1, chance: 100 }],
  },
  {
    id: 'fixture-dizzy-dance',
    name: 'Dizzy Dance',
    description: 'A twirly dance that makes heads spin.',
    element: 'leaf',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'status', status: 'dizzy', chance: 100 }],
  },
  {
    id: 'fixture-leafy-boop',
    name: 'Leafy Boop',
    description: 'A soft boop with a fluffy leaf.',
    element: 'leaf',
    power: 45,
    accuracy: 100,
  },
  {
    id: 'fixture-lullaby',
    name: 'Lullaby',
    description: 'A sleepy little song.',
    element: 'shadow',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'status', status: 'sleepy', chance: 100 }],
  },
];

export const FIXTURE_SPECIES: Species[] = [
  {
    id: 'fixture-puddlepuff',
    name: 'Puddlepuff',
    description: 'A wobbly little puddle that loves to splash.',
    element: 'water',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 45, attack: 40, defense: 35, speed: 55 },
    moves: ['fixture-giggle-drizzle', 'fixture-belly-flop'],
    evolutions: [{ into: 'fixture-splashmallow', level: 16 }],
    visual: {
      body: 'blob',
      palette: ['#6ec6ff', '#ffffff'],
      parts: ['dot-eyes', 'open-mouth', 'round-ears'],
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly'] },
  },
  {
    id: 'fixture-splashmallow',
    name: 'Splashmallow',
    description: 'Bigger, bouncier and twice as splashy.',
    element: 'water',
    feeling: 'silly',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 60, defense: 55, speed: 75 },
    moves: ['fixture-giggle-drizzle', 'fixture-belly-flop'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#3fa9f5', '#ffffff', '#ffd1e8'],
      parts: ['dot-eyes', 'open-mouth', 'round-ears', 'bat-wings', 'spots'],
      size: 1.25,
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly', 'joy'] },
  },
  {
    id: 'fixture-pebblesnooze',
    name: 'Pebblesnooze',
    description: 'A round pebble that is almost always napping.',
    element: 'stone',
    feeling: 'sleepy',
    rarity: 'common',
    season: 'halloween',
    baseStats: { hp: 60, attack: 35, defense: 60, speed: 20 },
    moves: ['fixture-rock-a-bye', 'fixture-pebble-puff'],
    evolutions: [],
    visual: { body: 'pebble', palette: ['#a39e93'], parts: ['sleepy-eyes', 'tiny-smile'] },
    habitatPreferences: { elements: ['stone'], feelings: ['sleepy'] },
  },
  // Battle engine fixtures (#11).
  {
    id: 'fixture-emberbun',
    name: 'Emberbun',
    description: 'A toasty bunny with a cozy glow.',
    element: 'fire',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 50, attack: 55, defense: 40, speed: 60 },
    moves: [
      'fixture-tickle-tackle',
      'fixture-cuddle-nap',
      'fixture-zippy-zoom',
      'fixture-silly-face',
    ],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#ff8a3d', '#ffe0b2'],
      parts: ['oval-eyes', 'cat-mouth', 'long-ears', 'blush-cheeks'],
      glow: 'accent',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['cozy'] },
  },
  {
    id: 'fixture-twirlysprout',
    name: 'Twirlysprout',
    description: 'A leafy sprout that never stops twirling.',
    element: 'leaf',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 55, attack: 45, defense: 45, speed: 45 },
    moves: ['fixture-leafy-boop', 'fixture-dizzy-dance', 'fixture-lullaby', 'fixture-silly-face'],
    evolutions: [],
    visual: { body: 'bean', palette: ['#7bd389'], parts: ['happy-eyes', 'smile', 'leaf-sprout'] },
    habitatPreferences: { elements: ['leaf'], feelings: ['joy'] },
  },
  {
    id: 'fixture-snoozlet',
    name: 'Snoozlet',
    description: 'Too sleepy to do much more than hum.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: { hp: 40, attack: 30, defense: 30, speed: 30 },
    moves: ['fixture-lullaby', 'fixture-cuddle-nap'],
    evolutions: [],
    visual: { body: 'drop', palette: ['#5b5280'], parts: ['sleepy-eyes'], ink: '#fff4dc' },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
  },
];

export const FIXTURE_SPAWN_TABLES: SpawnTable[] = [
  {
    id: 'fixture-forest-day',
    terrains: ['forest'],
    timeOfDay: 'day',
    entries: [
      { species: 'fixture-puddlepuff', weight: 10 },
      { species: 'fixture-pebblesnooze', weight: 3 },
    ],
  },
];

/**
 * A secret line for the server data checks: a secret squishy with secret
 * moves that grows into a secret form, so the cases don't lean on whichever
 * secrets the roster ships.
 */
export const FIXTURE_SECRET_MOVES: Move[] = [
  {
    id: 'fixture-hush-hum',
    name: 'Hush Hum',
    description: 'A soft, sleepy hum under the moon.',
    element: 'shadow',
    power: 40,
    accuracy: 100,
  },
  {
    id: 'fixture-moon-blink',
    name: 'Moon Blink',
    description: 'A slow, glowy blink that makes it feel extra quick.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 }],
  },
];

export const FIXTURE_SECRET_SPECIES: Species[] = [
  {
    id: 'fixture-moonpuff',
    name: 'Moonpuff',
    description: 'A tiny puff that only comes out when the moon is just right.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'secret',
    baseStats: { hp: 50, attack: 40, defense: 45, speed: 60 },
    moves: ['fixture-hush-hum', 'fixture-moon-blink'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#3b3561', '#f5e6a8'],
      parts: ['sleepy-eyes', 'tiny-smile'],
      ink: '#fff4dc',
      finish: 'iridescent',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
  },
  {
    id: 'fixture-moonmallow',
    name: 'Moonmallow',
    description: 'Moonpuff, all grown up and glowing softly.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'secret',
    baseStats: { hp: 75, attack: 60, defense: 65, speed: 80 },
    moves: ['fixture-hush-hum', 'fixture-moon-blink'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#3b3561', '#f5e6a8', '#c9b8ff'],
      parts: ['sleepy-eyes', 'tiny-smile', 'nub-wings'],
      size: 1.2,
      ink: '#fff4dc',
      finish: 'iridescent',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
  },
];

export const FIXTURE_SECRET_EVOLUTIONS: SecretEvolution[] = [
  { from: 'fixture-moonpuff', into: 'fixture-moonmallow', level: 20 },
];
