import type { HomeBaseRules } from '../schemas/data/home-base.js';

/** Home-base rules (design doc §13–14). */
export const HOME_BASE_RULES: HomeBaseRules = {
  spotsPerTile: 7,
  nightfallMinute: 21 * 60, // TUNE: design doc §14 default, 9:00 PM map time
  removeRefundPercent: 50, // TUNE:
  buildableKinds: ['hearthfire', 'habitat'],
};
