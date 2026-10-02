/**
 * TEST FIXTURES ONLY. Never shipped and never exported from the package.
 * Just enough species, moves and spawn tables to exercise the schemas; the
 * real launch roster arrives with issue #10.
 */
import type { SpawnTable } from '../../src/data/server/index.js';
import type { Move, Species } from '../../src/index.js';

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
    visual: { body: 'blob', palette: ['#6ec6ff', '#ffffff'], parts: ['round-ears'] },
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
    visual: { body: 'blob', palette: ['#3fa9f5', '#ffffff', '#ffd1e8'], parts: ['round-ears'] },
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
    visual: { body: 'pebble', palette: ['#a39e93'], parts: [] },
    habitatPreferences: { elements: ['stone'], feelings: ['sleepy'] },
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
