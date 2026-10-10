import { z } from 'zod';
import { BattleAiPolicySchema } from './battle.js';

const positiveInt = z.number().int().positive();

/**
 * Live battles (#29): both sides are players, each picks a move at the same
 * time, and the turn plays when both have picked. Public: the client counts
 * the turn timer down from the server's deadline.
 */
export const LiveBattleRulesSchema = z.strictObject({
  /** Seconds each side has to pick (or send someone out). Then the AI picks for them. */
  turnSeconds: positiveInt,
  /**
   * Extra seconds, once, for a side that isn't connected when its time runs
   * out (iOS drops the socket when the app goes to the background). Comes
   * back when that side picks again.
   */
  awayGraceSeconds: z.number().int().min(0),
  /** The AI style that picks for a side whose time ran out, when it has none of its own. */
  coverPolicy: BattleAiPolicySchema,
});
export type LiveBattleRules = z.infer<typeof LiveBattleRulesSchema>;
