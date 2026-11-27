import type { LongNightSecrets } from '../../schemas/data/long-night-secrets.js';
import type { MonthDay } from '../../schemas/data/seasons.js';

/** The Long Night's secret strength (#727). Secret (CLAUDE.md rule 6). */
export const LONG_NIGHT_SECRETS: LongNightSecrets = {
  strengthMultiplier: 3, // TUNE: the issue's "3× the stage odds"; the sim (#727b) checks it
};

/**
 * Patch-local days that never hold a Long Night (#37 C0b): on Christmas Eve
 * the patch faces the BIG snowy squishy instead, so a Long Night weekday
 * that lands on it is skipped. The ordinary nightfall still runs, with the
 * Twinkle Lights counting (owner answer 4 on the Christmas plan). Read by
 * `isLongNight` from X1; secret like the rest of this file.
 */
export const QUIET_NIGHTS: readonly MonthDay[] = ['12-24']; // TUNE: addendum "Schedule"
