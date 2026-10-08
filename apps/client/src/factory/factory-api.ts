import {
  FactoryQueueResponseSchema,
  InventoryResponseSchema,
  StopFactoryQueueResponseSchema,
  type FactoryQueueResponse,
  type InventoryResponse,
  type StopFactoryQueueResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The Crafting Factory's calls (#294; server: modules/factory). */
export const factoryApi = {
  /** A batch of one recipe; `count: 'max'` asks for as many as the bag allows. `key` makes a retry safe. */
  start: (
    mapId: string,
    recipeId: string,
    count: number | 'max',
    key: string,
  ): Promise<FactoryQueueResponse> =>
    apiCallFor(`/maps/${mapId}/factory/queues`, {
      method: 'POST',
      body: { recipeId, count },
      schema: FactoryQueueResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Stops a batch: what's made is kept, the rest comes back. */
  stop: (mapId: string, batchId: string, key: string): Promise<StopFactoryQueueResponse> =>
    apiCallFor(`/maps/${mapId}/factory/queues/${batchId}/stop`, {
      method: 'POST',
      schema: StopFactoryQueueResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  // Dev builds only (server `HP_DEV_SQUISHY_GRANTS`): my batches finish now.
  dev: {
    ready: (mapId: string): Promise<InventoryResponse> =>
      apiCallFor(`/maps/${mapId}/dev/factory/ready`, {
        method: 'POST',
        schema: InventoryResponseSchema,
      }),
  },
};

export type FactoryApi = typeof factoryApi;
