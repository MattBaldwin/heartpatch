import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';

/**
 * Inventory things (design doc §12): gathered from nodes, seasonal (only
 * gathered in their season, kept as keepsakes after), or crafted by recipes.
 */
export const ResourceKindSchema = z.enum(['gathered', 'seasonal', 'crafted']);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

/**
 * How a resource node gathers (design doc §12): one gather takes `seconds`
 * and yields `quantity`. `extras` are bonus finds that come with it; an extra
 * that is a seasonal resource only turns up while its season is on.
 */
export const GatherSettingsSchema = z.strictObject({
  seconds: z.number().int().positive(),
  quantity: z.number().int().positive(),
  extras: z
    .array(z.strictObject({ resource: ContentIdSchema, quantity: z.number().int().positive() }))
    .optional(),
});
export type GatherSettings = z.infer<typeof GatherSettingsSchema>;

export const ResourceSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  kind: ResourceKindSchema,
  /** Required for seasonal resources, not allowed otherwise. */
  season: ContentIdSchema.optional(),
  /**
   * Gathering from a node of this resource. Every resource a map can put on
   * a node (terrains, home rings) needs one; `checkGameData` checks it.
   */
  gather: GatherSettingsSchema.optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;
