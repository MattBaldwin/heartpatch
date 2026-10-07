import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';
import { ElementIdSchema } from './elements.js';

export const RecipeSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  inputs: ResourceCostSchema.refine(
    (inputs) => Object.keys(inputs).length > 0,
    'a recipe needs at least one input',
  ),
  output: z.strictObject({
    resource: ContentIdSchema,
    quantity: z.number().int().positive(),
  }),
  craftSeconds: z.number().int().nonnegative(),
  /** Seasonal recipes only unlock during their season (design doc §15). */
  season: ContentIdSchema.optional(),
  /**
   * Quicker with a squishy of this element on the player's team when the
   * craft starts (#238: a Frost squishy freezes Water faster): `percent` off
   * `craftSeconds`.
   */
  fasterWith: z
    .strictObject({ element: ElementIdSchema, percent: z.number().int().min(1).max(90) })
    .optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;
