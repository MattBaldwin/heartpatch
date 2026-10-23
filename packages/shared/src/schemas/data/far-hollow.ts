import { z } from 'zod';
import { ContentIdSchema } from './common.js';

/**
 * The far Hollow's secrets (#306 PR 6, plan Q7). Server-only (CLAUDE.md rule
 * 6): its odds and what finishing it gives. Exported only from
 * `@heartpatch/shared/server`; what a kid can see is `COMMUNITY_RULES.farHollow`.
 */
export const FarHollowSecretsSchema = z.strictObject({
  /** How much more often a far-Hollow find (a room's bloom) is the joy (Heartdust) than an ordinary search's (plan Q7: 4×). */
  heartdustFindMultiplier: z.number().int().min(1),
  /**
   * The season's guaranteed lore page: the attic's chest gives the first of
   * these the kid hasn't found yet (each an `explore.searched` page, so the
   * lore consumer grants it like any explore find).
   */
  lorePages: z.array(ContentIdSchema).min(1),
  /** What the attic's chest also holds, every season: the joy coming home. */
  completionGift: z.record(ContentIdSchema, z.number().int().min(1)),
});
export type FarHollowSecrets = z.infer<typeof FarHollowSecretsSchema>;
