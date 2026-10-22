import { z } from 'zod';

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
   * On a patch with no challenges, how far a key on someone else's land may
   * move to the nearest wild tile (owner decision 2026-10-22); with none that
   * near it stays, and land next to it is enough.
   */
  keyMoveRange: z.number().int().min(1),
});
export type CellarRules = z.infer<typeof CellarRulesSchema>;
