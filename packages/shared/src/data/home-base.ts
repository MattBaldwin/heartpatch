import type { HomeBaseRules } from '../schemas/data/home-base.js';

/** Home-base rules (design doc §13–14). */
export const HOME_BASE_RULES: HomeBaseRules = {
  spotsPerTile: 7,
  nightfallMinute: 21 * 60, // TUNE: design doc §14 default, 9:00 PM map time
  removeRefundPercent: 50, // TUNE:
  // Training Grounds: owner decision 2026-10-06. Fences (#203) go on edges,
  // from the tile's panel, not the home build sheet.
  buildableKinds: ['hearthfire', 'habitat', 'training-grounds', 'fence'],
};
