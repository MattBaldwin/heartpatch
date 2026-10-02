import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { ElementIdSchema, FeelingIdSchema } from './data/elements.js';

// Owned squishies as players see them (design doc §4 "Instance fields").
// Stats, care and habitat fields arrive with their issues.

export const SquishyStateSchema = z.enum(['active', 'hollowed']);
export type SquishyState = z.infer<typeof SquishyStateSchema>;

export const OwnedSquishySchema = z.object({
  id: z.uuid(),
  mapId: z.uuid(),
  ownerUserId: z.uuid(),
  speciesId: ContentIdSchema,
  element: ElementIdSchema,
  feeling: FeelingIdSchema,
  nickname: z.string().nullable(),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  state: SquishyStateSchema,
});
export type OwnedSquishy = z.infer<typeof OwnedSquishySchema>;

export const SquishyResponseSchema = z.object({ squishy: OwnedSquishySchema });
export type SquishyResponse = z.infer<typeof SquishyResponseSchema>;
