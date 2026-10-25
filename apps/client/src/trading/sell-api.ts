import {
  SellBasketResponseSchema,
  SellViewResponseSchema,
  type SellBasketRequest,
  type SellBasketResponse,
  type SellView,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The trading post's Sell tab (server: modules/post-sell, #601 PR 3; baskets #655). */
export const sellApi = {
  /** What I could sell on this patch, and today's selling against the cap. */
  view: (mapId: string): Promise<SellView> =>
    apiCallFor(`/maps/${mapId}/posts/sell`, {
      method: 'GET',
      schema: SellViewResponseSchema,
    }).then((res) => res.sell),
  /** One basket at the post at (q, r), every line or none; a retry with the same key never sells twice. */
  sell: (mapId: string, request: SellBasketRequest, key: string): Promise<SellBasketResponse> =>
    apiCallFor(`/maps/${mapId}/posts/sell`, {
      method: 'POST',
      body: request,
      schema: SellBasketResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type SellApi = typeof sellApi;
