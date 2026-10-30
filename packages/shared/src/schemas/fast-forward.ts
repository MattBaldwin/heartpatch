import { z } from 'zod';

/*
 * The dev fast-forward (#736, `HP_DEV_SQUISHY_GRANTS` only): seeds my account
 * on a patch as the casual kid stands at the end of day 3, 10 or 21
 * (PLAYTEST.md "Day-N cold play").
 */
export const DevFastForwardRequestSchema = z.strictObject({
  day: z.union([z.literal(3), z.literal(10), z.literal(21)]),
});
export type DevFastForwardRequest = z.infer<typeof DevFastForwardRequestSchema>;

export const DevFastForwardResponseSchema = z.object({
  day: z.number().int(),
  /** The Partner's level now. */
  partnerLevel: z.number().int(),
  /** Tiles I hold now, home ring included. */
  tiles: z.number().int(),
  /** Teammates this call added. */
  added: z.number().int(),
});
export type DevFastForwardResponse = z.infer<typeof DevFastForwardResponseSchema>;
