import type { NamingRules } from '../schemas/data/naming.js';

/** Naming your home (#306 PR 0). Checked by `NamingRulesSchema` in tests. */
export const NAMING_RULES: NamingRules = {
  maxLength: 16, // TUNE: owner decision 2026-10-19, fits the flag on an iPhone SE
  caughtToName: 10, // TUNE: owner decision 2026-10-19
  // The kinds buildable when naming shipped (#306 PR 0); homestead-only ones stay out (#601 PR 7).
  kindsToName: ['hearthfire', 'habitat', 'training-grounds', 'fence', 'factory'],
};
