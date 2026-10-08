import {
  TradeShelfResponseSchema,
  TradesResponseSchema,
  type PickupRequest,
  type SendOfferRequest,
  type TradeShelf,
  type TradesView,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

type At = { q: number; r: number };

const command = (path: string, body: unknown, key: string): Promise<TradesView> =>
  apiCallFor(path, {
    method: 'POST',
    body,
    schema: TradesResponseSchema,
    headers: { 'idempotency-key': key },
  }).then((res) => res.trades);

/** Trades, gifts and the mailbox at a trading post (server: modules/trades/routes.ts, #271). */
export const tradeApi = {
  /** My open offers, my mailbox and recent returns. */
  view: (mapId: string): Promise<TradesView> =>
    apiCallFor(`/maps/${mapId}/trades`, { method: 'GET', schema: TradesResponseSchema }).then(
      (res) => res.trades,
    ),
  /** What a patch-mate (or I) could trade right now. */
  shelf: (mapId: string, userId: string): Promise<TradeShelf> =>
    apiCallFor(`/maps/${mapId}/trades/shelf/${userId}`, {
      method: 'GET',
      schema: TradeShelfResponseSchema,
    }).then((res) => res.shelf),
  send: (mapId: string, request: SendOfferRequest, key: string): Promise<TradesView> =>
    command(`/maps/${mapId}/trades`, request, key),
  accept: (mapId: string, offerId: string, at: At, key: string): Promise<TradesView> =>
    command(`/maps/${mapId}/trades/${offerId}/accept`, { q: at.q, r: at.r }, key),
  decline: (mapId: string, offerId: string, key: string): Promise<TradesView> =>
    command(`/maps/${mapId}/trades/${offerId}/decline`, undefined, key),
  cancel: (mapId: string, offerId: string, key: string): Promise<TradesView> =>
    command(`/maps/${mapId}/trades/${offerId}/cancel`, undefined, key),
  pickup: (mapId: string, request: PickupRequest, key: string): Promise<TradesView> =>
    command(`/maps/${mapId}/mailbox/pickup`, request, key),
};

export type TradeApi = typeof tradeApi;
