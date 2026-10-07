import { z } from 'zod';
import { FeelingIdSchema } from './elements.js';

const percent = z.number().int().min(0).max(100);

/**
 * Fence rules (#203, owner decisions 2026-10-06 and 2026-10-07). The fence
 * kinds and their levels live in `BUILDINGS` (`kind: 'fence'`); these are the
 * numbers every fence shares.
 */
export const FenceRulesSchema = z.strictObject({
  /**
   * A full repair costs this percent of everything spent on the segment
   * (rounded up per item, scaled by how much energy it lost).
   */
  repairPercent: percent,
  /**
   * A fence battle lasts at most this many turns. A fence still standing
   * then has held: it keeps the energy it lost, and the try is spent.
   */
  battleTurns: z.number().int().min(1).max(50),
  /**
   * The stats a fence never uses (it makes no moves), and the feeling its
   * battle state carries. The feeling is ignored in the maths: a fence's
   * matchup is its material's element only.
   */
  battle: z.strictObject({
    attack: z.number().int().min(1),
    speed: z.number().int().min(1),
    feeling: FeelingIdSchema,
  }),
});
export type FenceRules = z.infer<typeof FenceRulesSchema>;
