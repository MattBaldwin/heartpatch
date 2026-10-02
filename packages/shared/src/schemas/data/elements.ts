import { z } from 'zod';
import { DescriptionSchema, DisplayNameSchema } from './common.js';

/**
 * The element set (design doc §5). Elements are a closed set because the
 * element matrix and synergy table must cover every pair.
 */
export const ElementIdSchema = z.enum([
  'fire',
  'water',
  'leaf',
  'frost',
  'spark',
  'stone',
  'shadow',
  'light',
]);
export type ElementId = z.infer<typeof ElementIdSchema>;

/** The feeling set (design doc §5). Closed for the same reason as elements. */
export const FeelingIdSchema = z.enum(['joy', 'cozy', 'brave', 'silly', 'sleepy', 'spooky']);
export type FeelingId = z.infer<typeof FeelingIdSchema>;

export const ElementSchema = z.strictObject({
  id: ElementIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
});
export type Element = z.infer<typeof ElementSchema>;

export const FeelingSchema = z.strictObject({
  id: FeelingIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
});
export type Feeling = z.infer<typeof FeelingSchema>;
