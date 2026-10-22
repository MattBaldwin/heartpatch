import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { CommunityKindIdSchema } from './communities.js';

/**
 * The key hunt and the hidden cellar (#306 PR 2c). Server-only (CLAUDE.md
 * rule 6): how far the key hides from its village would narrow the hunt,
 * and the cellar's odds are find odds. Exported only from
 * `@heartpatch/shared/server`.
 */
export const CellarKeyRangeSchema = z
  .strictObject({ min: z.number().int().min(2), max: z.number().int().min(2) })
  .refine((k) => k.min <= k.max, 'keyFromVillage.min must not exceed max');
export type CellarKeyRange = z.infer<typeof CellarKeyRangeSchema>;

export const CellarRulesSchema = z.strictObject({
  /** The cellar key's tile: this many steps from the nearest village tile (owner decision 5). */
  keyFromVillage: CellarKeyRangeSchema,
  /**
   * How much more often a cellar spot holds a rare find (Heartdust or a lore
   * page) than a grey village tile's, once its empty finds are taken out (a
   * cellar spot is never empty). With today's tables that's about 2.4× a grey
   * tile's share: the issue's "about 2×".
   */
  rareFindMultiplier: z.number().int().min(1),
  /**
   * The big chest in the middle of the cellar (#306, owner decision of
   * 2026-10-22): the cellar's best loot, a big pile of finds and the
   * cellar's keepsake.
   */
  bigChest: z.strictObject({
    /** It opens once every small chest is open (owner to judge on the screens). */
    afterSmall: z.boolean(),
    /** The big pile: item id → how many. */
    items: z.record(ContentIdSchema, z.number().int().min(1).max(50)),
    /**
     * Each kind of Hollow's one-of-a-kind keepsake: a found piece of
     * clothing (`CLOTHING`), never one kind's twice. Secret until found.
     */
    keepsakes: z.record(CommunityKindIdSchema, ContentIdSchema),
  }),
});
export type CellarRules = z.infer<typeof CellarRulesSchema>;
