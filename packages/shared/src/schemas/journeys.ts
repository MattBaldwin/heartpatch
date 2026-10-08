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
