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
  // Only Heartlet's line knows it, so naming it publicly would give it away.
  {
    id: 'heart-glow',
    name: 'Heart Glow',
    description:
      'A warm, pink glow from deep inside. It feels a little better, and a bit sturdier.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'heal', percent: 30 }, // TUNE:
      { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 100 }, // TUNE:
    ],
  },
  // Only Heartsong knows it (#32), so naming it publicly would give it away.
  {
    id: 'heart-chorus',
    name: 'Heart Chorus',
    description: 'Hums a happy little song and gets a bounce in its step.',
    element: 'light',
    power: 60, // TUNE:
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 30 }], // TUNE:
  },
];

export const SECRET_SPECIES: Species[] = [
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
    baseStats: { hp: 60, attack: 55, defense: 60, speed: 55 }, // TUNE:
    moves: ['sunny-beam', 'cozy-crackle', 'heart-glow'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#ffc2d6', '#fff6f9', '#ff7aa2', '#ffe066'],
      parts: ['oval-eyes', 'tiny-smile', 'blush-cheeks', 'nub-wings'],
      finish: 'iridescent',
      glow: 'body',
      stance: 0.3,
      pose: 'hover',
      attackPart: 'wings',
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
    baseStats: { hp: 80, attack: 70, defense: 80, speed: 75 }, // TUNE:
    moves: ['sunny-beam', 'cozy-crackle', 'heart-glow', 'night-light'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#ffadc8', '#fff6f9', '#ff5c8f', '#ffd23f'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'glow-wings',
        'leaf-sprout',
        'stubby-arms',
        'freckles',
      ],
      size: 1.3,
      finish: 'iridescent',
      glow: 'body',
      head: { body: 'orb', size: 0.72, forward: 0.1, up: 0.78 },
      stance: 0.5,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'joy'] },
  },
  // Heartlet's branch (#32): Light + Joy, for a Heartlet that sang by a
  // bright fire all night.
  {
    id: 'heartsong',
    name: 'Heartsong',
    description: 'A Heartlet that sang by a bright fire all night. It still hums the tune.',
    element: 'light',
    feeling: 'joy',
    rarity: 'secret',
    baseStats: { hp: 70, attack: 75, defense: 60, speed: 75 }, // TUNE:
    moves: ['sunny-beam', 'heart-glow', 'dazzle-dance', 'heart-chorus'],
    evolutions: [],
    visual: {
      body: 'heart',
      palette: ['#9a70f0', '#ffd0e6', '#5a2068', '#ffb627'],
      ink: '#1e0a2e',
      parts: ['happy-eyes', 'bold-happy-eyes', 'round-mouth', 'heart-blush', 'round-hands'],
      size: 1.3,
      finish: 'iridescent',
      glow: 'body',
      stance: 0.3,
      pose: 'hover',
      attackPart: 'arms',
      // No sparkle flecks between its eyes or on its bottom point.
      sparkleOffFace: true,
      // A gold song note floating just above its right shoulder, facing you.
      floater: {
        glyph: 'music-note',
        size: 0.38, // TUNE: of the body's height
        above: -0.02, // TUNE: gap above its top
        side: 0.57, // TUNE: of the body's width, to the viewer's right
        color: 'detail',
        bob: { height: 0.04, speed: 0.45 }, // TUNE
      },
    },
    habitatPreferences: { elements: ['light'], feelings: ['joy', 'cozy'] },
  },
];

export const SECRET_EVOLUTIONS: SecretEvolution[] = [
  { from: 'heartlet', into: 'heartbloom', level: 25 }, // TUNE:
  // Heartlet's branch (#32): Joy, at dusk or night, beside a fire full of fuel.
  {
    from: 'heartlet',
    into: 'heartsong',
    level: 25, // TUNE:
    trigger: {
      kind: 'rare',
      conditions: [{ kind: 'time', times: ['dusk', 'night'] }, { kind: 'fire-full' }],
      feeling: 'joy',
      // The schema wants one, but it never shows: no evolving meter before a secret form.
      whisper: {
        icon: '🔥',
        text: '{name} loves sitting by a bright, cozy fire…',
        sub: 'Especially when the stars are out.',
      },
    },
  },
];
