import type { TrickOrTreatRules } from '../schemas/data/trick-or-treat.js';

/**
 * Trick-or-treat (#515, owner answers 2026-10-18). Checked by
 * `checkTrickOrTreatRules` in tests. It runs in the Halloween season, by the
 * map's local date (2026: Oct 1 to Nov 9).
 */
export const TRICK_OR_TREAT: TrickOrTreatRules = {
  season: 'halloween',
  lanternBuildingId: 'jack-o-lantern-hearthfire',
  hostThanks: 1, // TUNE: owner answer 4, a small thank-you per visitor
};
