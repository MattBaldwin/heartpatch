import type { LongNightSecrets } from '../../schemas/data/long-night-secrets.js';

/** The Long Night's secret strength (#727). Secret (CLAUDE.md rule 6). */
export const LONG_NIGHT_SECRETS: LongNightSecrets = {
  strengthMultiplier: 3, // TUNE: the issue's "3× the stage odds"; the sim (#727b) checks it
};
