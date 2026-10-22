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
  // heart's size is for a heart-deep tile off the square (none today): the
  // square itself holds The forgotten story.
  relight: {
    rim: { size: 4, lanterns: 2, shadows: 2, loose: 0, empty: 0, slack: 3, minWork: 5 },
    inner: { size: 5, lanterns: 3, shadows: 3, loose: 2, empty: 1, slack: 3, minWork: 9 },
    heart: { size: 6, lanterns: 4, shadows: 5, loose: 3, empty: 2, slack: 4, minWork: 14 },
  },
  // The forgotten story (the approved mockup's day): one torn page a Hollow
  // tile, so a Hollow of 4–7 tiles has 4–7 clues.
  story: {
    moments: [
      {
        id: 'bell',
        emoji: '🔔',
        did: 'The bell rang',
        act: 'the bell rang',
        ing: 'the bell ringing',
      },
      {
        id: 'baker',
        emoji: '🥧',
        did: 'The baker sold pies',
        act: 'the baker sold pies',
        ing: 'the baker selling pies',
      },
      {
        id: 'miller',
        emoji: '🌾',
        did: 'The miller ground oats',
        act: 'the miller ground oats',
        ing: 'the miller grinding oats',
      },
      {
        id: 'fiddler',
        emoji: '🎻',
        did: 'The fiddler played',
        act: 'the fiddler played',
        ing: 'the fiddler playing',
      },
      {
        id: 'ferry',
        emoji: '⛵',
        did: 'The ferry left',
        act: 'the ferry left',
        ing: 'the ferry leaving',
      },
      {
        id: 'postie',
        emoji: '✉️',
        did: 'The postie brought letters',
        act: 'the postie brought letters',
        ing: 'the postie bringing letters',
      },
      {
        id: 'kite',
        emoji: '🪁',
        did: 'The twins flew a kite',
        act: 'the twins flew a kite',
        ing: 'the twins flying a kite',
      },
      {
        id: 'gardener',
        emoji: '🎃',
        did: 'The gardener watered the pumpkins',
        act: 'the gardener watered the pumpkins',
        ing: 'the gardener watering the pumpkins',
      },
    ],
    // TUNE: 4–5 tiles hold 5 moments, 6–7 tiles hold 6.
    sizes: [
      { tiles: 1, moments: 5 },
      { tiles: 6, moments: 6 },
    ],
    // TUNE: at most one clue says outright what came first or last.
    maxPlaceClues: 1,
  },
};
