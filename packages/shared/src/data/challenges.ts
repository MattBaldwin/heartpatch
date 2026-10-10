import type { ChallengeRules } from '../schemas/data/challenges.js';

/** Friendly battles (#29). Checked by `ChallengeRulesSchema` in tests. */
export const CHALLENGE_RULES: ChallengeRules = {
  expireSeconds: 60, // TUNE: long enough to finish a tap somewhere else
  perPair: { max: 3, minutes: 10 }, // TUNE: nobody gets asked over and over
  perPlayer: { max: 10, minutes: 60 }, // TUNE: guess
  notNowRestMinutes: 5, // TUNE: "Not now!" means a little while
  levelGapNote: 5, // TUNE: a team this many levels apart is a real mismatch
};

/**
 * The heads-up on a "Battle me?" card (#29, fairness across ages), from the
 * viewer's side: their team's top level against the other Keeper's.
 */
export function levelGapNote(
  mine: number,
  theirs: number,
  rules: ChallengeRules = CHALLENGE_RULES,
): 'they-are-stronger' | 'they-are-newer' | null {
  if (theirs - mine >= rules.levelGapNote) return 'they-are-stronger';
  if (mine - theirs >= rules.levelGapNote) return 'they-are-newer';
  return null;
}
