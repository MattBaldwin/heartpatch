import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { InventoryResponseSchema, ItemCountsSchema } from './inventory.js';

// Crafting Factory API (#294; tech spec §5). The client asks for a batch;
// the server caps it at what the bag can pay for and works out the timers
// (CLAUDE.md rules 1 and 7). Batches ride along on every inventory reply
// (`InventoryResponse.factory`), so the Bag, the Recipe Book and Home all
// count down from the replies and settles they already get.

/** `POST /maps/:mapId/factory/queues`: a batch of one recipe. `max`: as many as the bag allows. */
export const StartFactoryQueueRequestSchema = z.strictObject({
  recipeId: ContentIdSchema,
  count: z.union([z.number().int().min(1), z.literal('max')]),
});
export type StartFactoryQueueRequest = z.infer<typeof StartFactoryQueueRequestSchema>;

export const FactoryQueueParamsSchema = z.object({ mapId: z.uuid(), queueId: z.uuid() });

/** `POST …/factory/queues`: the batch that started, and the bag after. */
export const FactoryQueueResponseSchema = InventoryResponseSchema.extend({
  queue: z.object({ id: z.uuid(), total: z.number().int().min(1) }),
});
export type FactoryQueueResponse = z.infer<typeof FactoryQueueResponseSchema>;

/** `POST …/factory/queues/:queueId/stop`: how many were kept, what came back, and the bag after. */
export const StopFactoryQueueResponseSchema = InventoryResponseSchema.extend({
  kept: z.number().int().min(0),
  refunded: ItemCountsSchema,
});
export type StopFactoryQueueResponse = z.infer<typeof StopFactoryQueueResponseSchema>;
