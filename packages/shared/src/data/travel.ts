import type { TravelRules } from '../schemas/data/travel.js';

/**
 * Wild Isle roads, bridges and ferry docks (#621). Cozy Patches never read
 * these (`patchRules('cozy').travel` is null). Checked by `checkTravelRules`.
 */
export const TRAVEL_RULES: TravelRules = {
  roads: {
    levels: [
      { cost: { timber: 4 }, reach: 1, speedPercent: 105 }, // TUNE: Path
      { cost: { timber: 6, stone: 6 }, reach: 2, speedPercent: 110 }, // TUNE: Road
      { cost: { stone: 12, glimmer: 1 }, reach: 3, speedPercent: 120 }, // TUNE: Paved road
    ],
  },
  stranded: {
    afterHours: 36, // TUNE:
    graceHoursAfterBridgeLoss: 12, // TUNE:
  },
  bridgesShared: true, // owner answer Q3, 2026-10-24
  ferry: {
    range: 6, // TUNE: revision 1
    oneDockPerLake: true, // TUNE: revision 1
  },
};
