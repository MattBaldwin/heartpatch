import { z } from 'zod';

/**
 * Crafting Factory rules (#294, owner decisions 2026-10-08). Its levels (how
 * many batches run at once, and their costs) live in `BUILDINGS`
 * (`kind: 'factory'`); recipes are the pot's own.
 */
export const FactoryRulesSchema = z.strictObject({
  /**
   * Most things one batch can make. Not a game rule (a batch is as big as
   * the bag can pay for, owner decision 2026-10-08); it keeps counts and
   * timers sane.
   */
  maxBatch: z.number().int().min(1).max(9999),
  /**
   * The welcome-back card shows when the first settle after at least this
   * long away lands Factory things; shorter trips get the usual pop-up.
   */
  welcomeBackMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
});
export type FactoryRules = z.infer<typeof FactoryRulesSchema>;
