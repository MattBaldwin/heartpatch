import type { MemoryPuzzleRules } from '../schemas/data/memory-puzzles.js';

/**
 * Hollow puzzles on grey village tiles (#306 PR 2b, owner decisions
 * 2026-10-22: "Relight the path", built as the approved mockup). Three
 * broken things by terrain, and Relight's difficulty by how deep in the
 * Hollow the tile is. Checked by `MemoryPuzzleRulesSchema` in tests.
 */
export const MEMORY_PUZZLES: MemoryPuzzleRules = {
  skins: [
    {
      id: 'music-box',
      name: 'music box',
      emoji: '🎶',
      terrains: ['meadow', 'pumpkin-fields', 'clearing'],
      fixed: 'The music box sings again! 🎶',
    },
    {
      id: 'mural',
      name: 'mural',
      emoji: '🖼️',
      terrains: ['forest', 'old-forest'],
      fixed: 'The mural is bright again! 🖼️',
    },
    {
      id: 'fountain',
      name: 'fountain',
      emoji: '⛲',
      terrains: ['hills', 'mountains'],
      fixed: 'The fountain bubbles again! ⛲',
    },
  ],
  defaultSkin: 'music-box',
  // TUNE: the difficulty curve (the mockup's, measured over 300 seeds a
  // tier: a rim puzzle needs about 9 moves, inner 14, the heart 21). The
  // heart's size stands in on the square until The forgotten story lands.
  relight: {
    rim: { size: 4, lanterns: 2, shadows: 2, loose: 0, empty: 0, slack: 3, minWork: 5 },
    inner: { size: 5, lanterns: 3, shadows: 3, loose: 2, empty: 1, slack: 3, minWork: 9 },
    heart: { size: 6, lanterns: 4, shadows: 5, loose: 3, empty: 2, slack: 4, minWork: 14 },
  },
};
