import {
  AdventViewSchema,
  ClaimAdventResponseSchema,
  OpenPresentResponseSchema,
  type AdventView,
  type ClaimAdventResponse,
  type OpenPresentResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The advent calendar's calls (#37 1d; server: modules/advent/routes.ts). */
export const adventApi = {
  /** This year's calendar: each day's state, what it held or can hold. */
  view: (mapId: string): Promise<AdventView> =>
    apiCallFor(`/maps/${mapId}/advent`, { method: 'GET', schema: AdventViewSchema }),

  /** Opens the day tapped (today's, or a missed one). The server decides if it can be. */
  claim: (mapId: string, day: string, key: string): Promise<ClaimAdventResponse> =>
    apiCallFor(`/maps/${mapId}/advent/claim`, {
      method: 'POST',
      body: { day },
      schema: ClaimAdventResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Opens one wrapped present from the bag. The server finds out if there is one. */
  openPresent: (mapId: string, key: string): Promise<OpenPresentResponse> =>
    apiCallFor(`/maps/${mapId}/presents/open`, {
      method: 'POST',
      body: {},
      schema: OpenPresentResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type AdventApi = typeof adventApi;
