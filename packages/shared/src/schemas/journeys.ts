import { z } from 'zod';
import { HexSchema } from '../hex/index.js';

/**
 * `POST /maps/:mapId/posts/journey` (#270): set off on a journey to the
 * trading post at (q, r), or resume the battle going. Send an
 * `Idempotency-Key`. Replies with the battle (`BattleResponse`).
 */
export const StartJourneyRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type StartJourneyRequest = z.infer<typeof StartJourneyRequestSchema>;

/**
 * What a journey is for (#306 PR 6): a trading post's visit pass (`post`,
 * #270), or the far road from a post to the far Hollow (`far-hollow`).
 */
export const JourneyKindSchema = z.enum(['post', 'far-hollow']);
export type JourneyKind = z.infer<typeof JourneyKindSchema>;
