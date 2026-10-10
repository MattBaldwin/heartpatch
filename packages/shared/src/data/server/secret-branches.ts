import type { Move } from '../../schemas/data/moves.js';
import type { Species } from '../../schemas/data/species.js';

/* #32 DESIGN PROTOTYPE: the secret line's branch (server-only). */

const s = (hp: number, attack: number, defense: number, speed: number) => ({
  hp,
  attack,
  defense,
  speed,
});

/** The secret line's branch (server-only in the real build). */
export const SECRET_BRANCH_MOVES: Move[] = [
  {
    id: 'heart-chorus',
    name: 'Heart Chorus',
    description: 'Hums a happy little song that makes everyone glow.',
    element: 'light',
    power: 60,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 30 }],
  },
];

export const SECRET_BRANCH_SPECIES: Species[] = [
  {
    id: 'heartsong',
    name: 'Heartsong',
    description: 'A Heartlet that sang by a bright fire all night. It still hums the tune.',
    element: 'light',
    feeling: 'joy',
    rarity: 'secret',
    baseStats: s(70, 75, 60, 75),
    moves: ['sunny-beam', 'heart-glow', 'dazzle-dance', 'heart-chorus'],
    evolutions: [],
    visual: {
      body: 'drop',
      palette: ['#ffc2d6', '#fff6f9', '#ff7aa2', '#ffe066'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'sun-crown', 'glow-wings', 'ball-tail'],
      size: 1.3,
      finish: 'iridescent',
      glow: 'body',
      stance: 0.45,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['light'], feelings: ['joy', 'cozy'] },
  },
];
