import {
  BuyResponseSchema,
  ShopViewResponseSchema,
  type BuyRequest,
  type BuyResponse,
  type ShopView,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The trading post's Shop tab (server: modules/post-shop, #729a). */
export const shopApi = {
  /** What the post sells me, with each item's state, my 💛 and any lure held. */
  view: (mapId: string, at: { q: number; r: number }): Promise<ShopView> =>
    apiCallFor(`/maps/${mapId}/posts/shop?q=${String(at.q)}&r=${String(at.r)}`, {
      method: 'GET',
      schema: ShopViewResponseSchema,
    }).then((res) => res.shop),
  /** One item from the post at (q, r); a retry with the same key never buys twice. */
  buy: (mapId: string, request: BuyRequest, key: string): Promise<BuyResponse> =>
    apiCallFor(`/maps/${mapId}/posts/shop`, {
      method: 'POST',
      body: request,
      schema: BuyResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type ShopApi = typeof shopApi;
