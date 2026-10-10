import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { ElementIdSchema, FeelingIdSchema } from './data/elements.js';

// Owned squishies as players see them (design doc §4 "Instance fields").
// Stats, care and habitat fields arrive with their issues.

/** `/maps/:mapId/squishies/:squishyId/…` routes (care, habitats, the wardrobe). */
export const SquishyParamsSchema = z.object({ mapId: z.uuid(), squishyId: z.uuid() });

/** `in-trade` (#271): held in escrow for a trade or gift, off every job and out of every battle. */
export const SquishyStateSchema = z.enum(['active', 'hollowed', 'in-trade']);
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
  /**
   * The wardrobe accessory it wears (#43), or null, read back through
   * ownership. The care, home and job board reads fill it (#340); views that
   * don't load it leave it out.
   */
  accessory: ContentIdSchema.nullable().optional(),
});
export type OwnedSquishy = z.infer<typeof OwnedSquishySchema>;

export const SquishyResponseSchema = z.object({ squishy: OwnedSquishySchema });
export type SquishyResponse = z.infer<typeof SquishyResponseSchema>;
