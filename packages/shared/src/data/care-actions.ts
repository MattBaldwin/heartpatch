import type { CareAction } from '../schemas/data/care-actions.js';

/** Feed, pet and play only (docs/DECISIONS.md, design doc §7). */
export const CARE_ACTIONS: CareAction[] = [
  {
    id: 'feed',
    name: 'Feed',
    description: 'Share a yummy treat.',
    contentment: 20, // TUNE:
    cooldownSeconds: 4 * 60 * 60, // TUNE:
    cost: { treats: 1 }, // TUNE:
  },
  {
    id: 'pet',
    name: 'Pet',
    description: 'A gentle stroke. So soft!',
    contentment: 10, // TUNE:
    cooldownSeconds: 30 * 60, // TUNE:
  },
  {
    id: 'play',
    name: 'Play',
    description: 'A boop or a tickle. Hee hee!',
    contentment: 10, // TUNE:
    cooldownSeconds: 30 * 60, // TUNE:
  },
];
