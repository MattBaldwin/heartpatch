import {
  SellResponseSchema,
  SellViewResponseSchema,
  type SellRequest,
  type SellResponse,
  type SellView,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The trading post's Sell tab (server: modules/post-sell, #601 PR 3). */
export const sellApi = {
  /** What I could sell on this patch, and today's selling against the cap. */
  view: (mapId: string): Promise<SellView> =>
    apiCallFor(`/maps/${mapId}/posts/sell`, {
      method: 'GET',
      schema: SellViewResponseSchema,
    }).then((res) => res.sell),
  /** One sale at the post at (q, r); a retry with the same key never sells twice. */
  sell: (mapId: string, request: SellRequest, key: string): Promise<SellResponse> =>
    apiCallFor(`/maps/${mapId}/posts/sell`, {
      method: 'POST',
      body: request,
      schema: SellResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type SellApi = typeof sellApi;
