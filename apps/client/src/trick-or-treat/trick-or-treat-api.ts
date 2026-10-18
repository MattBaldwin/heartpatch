import {
  TrickOrTreatResponseSchema,
  TrickOrTreatVisitResponseSchema,
  type TrickOrTreatView,
  type TrickOrTreatVisitResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Trick-or-treat's calls (#515; server: modules/trick-or-treat/routes.ts). */
export const trickOrTreatApi = {
  /** Whether it's on today, and every patch-mate's door: lit, and visited today. */
  view: (mapId: string): Promise<TrickOrTreatView> =>
    apiCallFor(`/maps/${mapId}/trick-or-treat`, {
      method: 'GET',
      schema: TrickOrTreatResponseSchema,
    }).then((res) => res.trickOrTreat),

  /** Knocks on a patch-mate's door: today's treat from that home. */
  visit: (mapId: string, hostUserId: string, key: string): Promise<TrickOrTreatVisitResponse> =>
    apiCallFor(`/maps/${mapId}/trick-or-treat`, {
      method: 'POST',
      body: { hostUserId },
      schema: TrickOrTreatVisitResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type TrickOrTreatApi = typeof trickOrTreatApi;
