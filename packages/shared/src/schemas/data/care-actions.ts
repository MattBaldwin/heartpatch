import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';

/**
 * A care action (design doc §7). Care actions are data so a new one needs no
 * engine change; Phase 1 ships feed, pet and play (docs/DECISIONS.md).
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
});
export type CareAction = z.infer<typeof CareActionSchema>;
