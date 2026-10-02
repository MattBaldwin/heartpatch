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
  /** Server-side cooldown per squishy so tap-spamming can't max care. */
  cooldownSeconds: z.number().int().positive(),
  cost: ResourceCostSchema.optional(),
});
export type CareAction = z.infer<typeof CareActionSchema>;
