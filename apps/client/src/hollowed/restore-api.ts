import {
  CommunityViewSchema,
  RestoreTileResponseSchema,
  type CommunityView,
  type Hex,
  type RestoreTileResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Restoring and naming grey villages (#306 PR 3; server: modules/communities). `key` makes a retry safe. */
export const restoreApi = {
  sheet: (mapId: string, communityId: string, at: Hex): Promise<RestoreTileResponse> =>
    apiCallFor(
      `/maps/${mapId}/communities/${communityId}/restore?q=${String(at.q)}&r=${String(at.r)}`,
      { method: 'GET', schema: RestoreTileResponseSchema },
    ),

  restore: (
    mapId: string,
    communityId: string,
    body: Hex & { piecesDone: number },
    key: string,
  ): Promise<RestoreTileResponse> =>
    apiCallFor(`/maps/${mapId}/communities/${communityId}/restore`, {
      method: 'POST',
      body,
      schema: RestoreTileResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  name: (mapId: string, communityId: string, name: string, key: string): Promise<CommunityView> =>
    apiCallFor(`/maps/${mapId}/communities/${communityId}/name`, {
      method: 'POST',
      body: { name },
      schema: CommunityViewSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type RestoreApi = typeof restoreApi;
