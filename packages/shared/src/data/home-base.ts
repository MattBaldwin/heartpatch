import type { HomeBaseRules } from '../schemas/data/home-base.js';

/** Home-base rules (design doc §13–14). */
export const HOME_BASE_RULES: HomeBaseRules = {
  spotsPerTile: 7,
  nightfallMinute: 19 * 60, // TUNE: owner decision 2026-10-08 (#277), 7:00 PM map time, so kids see him come
  removeRefundPercent: 50, // TUNE:
  // Training Grounds: owner decision 2026-10-06. Fences (#203) go on edges,
  // from the tile's panel, not the home build sheet. The Crafting Factory: #294.
  buildableKinds: ['hearthfire', 'habitat', 'training-grounds', 'fence', 'factory'],
};
