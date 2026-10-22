import type { CareAction } from '../schemas/data/care-actions.js';

/**
 * Feed, pet and play (docs/DECISIONS.md, design doc §7), plus the Heart Snack,
 * Heartdust's first use (owner decision 2026-10-06). Diminishing
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
  {
    // Heartdust's first use (design review 2026-10-05, owner decision 2026-10-06).
    id: 'heart-snack',
    name: 'Heart Snack',
    description: 'A sparkly Heartdust treat that tastes like a big hug.',
    contentment: 25, // TUNE:
    cooldownSeconds: 10, // TUNE:
    cost: { heartdust: 3 }, // TUNE:
    outsideDailyCare: true,
  },
  {
    // Rekindled (#306 PR 5): brewed from Heart Petals found in a Hollowed
    // village. A rare treat like the Heart Snack, and a little cozier.
    id: 'heart-tea',
    name: 'Heart Tea',
    description: 'A warm cup of petal tea. Sip, sip, smile!',
    contentment: 30, // TUNE: a bit more than a Heart Snack, for a found recipe
    cooldownSeconds: 10, // TUNE:
    cost: { 'heart-tea': 1 },
    outsideDailyCare: true,
  },
];
