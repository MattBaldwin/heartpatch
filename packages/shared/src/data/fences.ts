import type { FenceRules } from '../schemas/data/fences.js';

/** Fence rules (#203). The fence kinds and their levels are in `BUILDINGS`. */
export const FENCE_RULES: FenceRules = {
  repairPercent: 25, // TUNE: owner decision 2026-10-07, "repair it cheaply"
  battleTurns: 6, // TUNE: mockup; a strong matchup breaks a level-1 fence in about 3
  battle: { attack: 1, speed: 1, feeling: 'sleepy' }, // never used: a fence sits very still
};
