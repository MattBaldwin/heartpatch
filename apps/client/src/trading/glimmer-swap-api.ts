import {
  GlimmerSwapResponseSchema,
  type GlimmerSwapRequest,
  type GlimmerSwapView,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The trading post's Glimmer swap (server: modules/trades, #523). */
export const glimmerSwapApi = {
  /** Today's swaps and what's in my bag. */
  view: (mapId: string): Promise<GlimmerSwapView> =>
    apiCallFor(`/maps/${mapId}/glimmer-swap`, {
      method: 'GET',
      schema: GlimmerSwapResponseSchema,
    }).then((res) => res.swap),
  /** One swap at the post at (q, r); a retry with the same key never swaps twice. */
  swap: (mapId: string, request: GlimmerSwapRequest, key: string): Promise<GlimmerSwapView> =>
    apiCallFor(`/maps/${mapId}/glimmer-swap`, {
      method: 'POST',
      body: request,
      schema: GlimmerSwapResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.swap),
};

export type GlimmerSwapApi = typeof glimmerSwapApi;
