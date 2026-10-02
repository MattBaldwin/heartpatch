import type { RescueGuardianRules } from '../../schemas/data/hollow.js';

/**
 * The shadow guardians a rescue expedition meets in the Hollow (design doc
 * §14). Secret (CLAUDE.md rule 6). A rescue is a planning lesson, not a wall:
 * they sit a little under the player's strongest squishy.
 */
export const RESCUE_GUARDIANS: RescueGuardianRules = {
  count: 1, // TUNE: guess; one shadow, so a single squishy can win
  levelOffset: -1, // TUNE: guess; just under the player's strongest squishy
  levels: { min: 1, max: 20 }, // TUNE: guess
  // TUNE: the Hollow's shadows look like Nookling, the year-round public
  // shadow squishy (#10), so a rescue never shows a player a secret species.
  entries: [{ species: 'nookling', weight: 1 }],
};
