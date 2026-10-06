import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';

/**
 * A care action (design doc §7). Care actions are data so a new one needs no
 * engine change; Phase 1 ships feed, pet and play (docs/DECISIONS.md) and
 * the Heart Snack (owner decision 2026-10-06).
 */
export const CareActionSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  /** Contentment added, on the 0–100 scale. */
  contentment: z.number().int().min(1).max(100),
  /**
   * Seconds before the same action on the same squishy counts again: a
   * debounce, so one gesture can't count twice. Diminishing returns
   * (`CARE_RULES`) are what keep tap-spamming from maxing care.
   */
  cooldownSeconds: z.number().int().positive(),
  cost: ResourceCostSchema.optional(),
  /**
   * A rare treat (the Heart Snack): always gives its full contentment, isn't
   * counted toward the day's diminishing returns and earns no Patch Coins,
   * so spending Heartdust is never wasted on a well-loved day.
   */
  outsideDailyCare: z.literal(true).optional(),
});
export type CareAction = z.infer<typeof CareActionSchema>;
