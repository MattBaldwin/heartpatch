import { z } from 'zod';

const positiveInt = z.number().int().positive();
const window = z.strictObject({ max: positiveInt, minutes: positiveInt });

/**
 * Friendly battles (#29): "Battle me?" between two Keepers who are both on
 * the patch. Public: the client shows the wait and the level-gap note from
 * the same numbers the server checks.
 */
export const ChallengeRulesSchema = z.strictObject({
  /** Seconds an ask waits for an answer before it floats away. */
  expireSeconds: positiveInt,
  /** Asks one player may send another within `minutes`. */
  perPair: window,
  /** Asks one player may send anyone within `minutes`. */
  perPlayer: window,
  /** Minutes after a "Not now!" before asking that player again. */
  notNowRestMinutes: z.number().int().min(0),
  /** Team levels this far apart (or more) show a friendly heads-up on the card. */
  levelGapNote: positiveInt,
});
export type ChallengeRules = z.infer<typeof ChallengeRulesSchema>;
