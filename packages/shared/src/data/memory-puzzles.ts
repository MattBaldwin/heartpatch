import type { MemoryPuzzleRules } from '../schemas/data/memory-puzzles.js';

/**
 * Memory puzzles on grey village tiles (#306 PR 2b, plan Q5: one 4-piece
 * ordered puzzle a tile, three skins by terrain). Checked by
 * `MemoryPuzzleRulesSchema` in tests. Pieces are picture-different, not
 * colour-different, so every kid can tell them apart.
 */
export const MEMORY_PUZZLES: MemoryPuzzleRules = {
  pieceCount: 4,
  skins: [
    {
      id: 'music-box',
      name: 'music box',
      emoji: '🎶',
      terrains: ['meadow', 'pumpkin-fields', 'clearing'],
      pieces: [
        { id: 'bell', emoji: '🔔', name: 'the bell' },
        { id: 'drum', emoji: '🥁', name: 'the drum' },
        { id: 'horn', emoji: '🎺', name: 'the horn' },
        { id: 'fiddle', emoji: '🎻', name: 'the fiddle' },
      ],
      watch: 'Listen! The music box remembers its tune…',
      play: 'Play the tune back in the same order!',
      easy: 'Hum along',
      fixed: 'The music box sings again! 🎶',
    },
    {
      id: 'mural',
      name: 'mural',
      emoji: '🖼️',
      terrains: ['forest', 'old-forest'],
      pieces: [
        { id: 'sun', emoji: '🌞', name: 'the sun' },
        { id: 'tree', emoji: '🌳', name: 'the tree' },
        { id: 'house', emoji: '🏡', name: 'the house' },
        { id: 'rainbow', emoji: '🌈', name: 'the rainbow' },
      ],
      watch: 'Look! The mural shows its pictures in order…',
      play: 'Put the pictures back in the same order!',
      easy: 'Peek at it',
      fixed: 'The mural is bright again! 🖼️',
    },
    {
      id: 'fountain',
      name: 'fountain',
      emoji: '⛲',
      terrains: ['hills', 'mountains'],
      pieces: [
        { id: 'fish', emoji: '🐟', name: 'the fish' },
        { id: 'frog', emoji: '🐸', name: 'the frog' },
        { id: 'duck', emoji: '🦆', name: 'the duck' },
        { id: 'turtle', emoji: '🐢', name: 'the turtle' },
      ],
      watch: 'Watch! The fountain tiles splash in order…',
      play: 'Set the tiles back in the same order!',
      easy: 'Splash a hint',
      fixed: 'The fountain bubbles again! ⛲',
    },
  ],
  defaultSkin: 'music-box',
};
