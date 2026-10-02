import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';

/**
 * Inventory things (design doc §12): gathered from nodes, seasonal (only
 * gathered in their season, kept as keepsakes after), or crafted by recipes.
 */
export const ResourceKindSchema = z.enum(['gathered', 'seasonal', 'crafted']);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const ResourceSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  kind: ResourceKindSchema,
  /** Required for seasonal resources, not allowed otherwise. */
  season: ContentIdSchema.optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;
