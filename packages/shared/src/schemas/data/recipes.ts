import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';

export const RecipeSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  inputs: ResourceCostSchema,
  output: z.strictObject({
    resource: ContentIdSchema,
    quantity: z.number().int().positive(),
  }),
  craftSeconds: z.number().int().nonnegative(),
  /** Seasonal recipes only unlock during their season (design doc §15). */
  season: ContentIdSchema.optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;
