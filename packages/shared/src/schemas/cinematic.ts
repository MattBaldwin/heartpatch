import { z } from 'zod';

// Opening cinematic API schemas (design doc §25; issue #46). The account
// remembers the first time the player watched it to the end (or skipped it),
// so it plays once and can be skipped after that.

/** Whether the player has seen the opening cinematic. */
export const CinematicStateSchema = z.object({
  /** First time it was seen; null until then. Set = skippable, and never auto-played again. */
  seenAt: z.iso.datetime().nullable(),
});
export type CinematicState = z.infer<typeof CinematicStateSchema>;

/** `GET /api/v1/cinematic` and `POST /api/v1/cinematic/seen` (idempotent: the first time stays). */
export const CinematicResponseSchema = z.object({ cinematic: CinematicStateSchema });
export type CinematicResponse = z.infer<typeof CinematicResponseSchema>;
