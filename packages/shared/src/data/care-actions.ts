import type { CareAction } from '../schemas/data/care-actions.js';

/**
 * Feed, pet and play only (docs/DECISIONS.md, design doc §7). Diminishing
 * returns (`CARE_RULES`) stop care from being a screen-time contest
 * (decision G); the cooldown is only a short debounce so one stroke or a
 * double tap doesn't count twice (DECISIONS "Care (#19)").
 */
export const CARE_ACTIONS: CareAction[] = [
  {
    id: 'feed',
    name: 'Feed',
    description: 'Share a yummy treat.',
    contentment: 20, // TUNE:
    cooldownSeconds: 10, // TUNE:
    cost: { treats: 1 }, // TUNE:
  },
  {
    id: 'pet',
    name: 'Pet',
    description: 'A gentle stroke. So soft!',
    contentment: 10, // TUNE:
    cooldownSeconds: 10, // TUNE:
  },
  {
    id: 'play',
    name: 'Play',
    description: 'A boop or a tickle. Hee hee!',
    contentment: 10, // TUNE:
    cooldownSeconds: 10, // TUNE:
  },
];
