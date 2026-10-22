import {
  CellarViewSchema,
  CommunityViewSchema,
  SearchSpotResponseSchema,
  type CellarView,
  type CommunityView,
  type SearchSpotResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/**
 * The hidden cellar (#306 PR 2c; server: modules/communities/cellar). The key
 * itself is found by exploring its tile (explore-api). `key` makes a retry safe.
 */
export const cellarApi = {
  /** Open the cellar under the square with the key. */
  open: (mapId: string, communityId: string, key: string): Promise<CommunityView> =>
    apiCallFor(`/maps/${mapId}/communities/${communityId}/cellar`, {
      method: 'POST',
      schema: CommunityViewSchema,
      headers: { 'idempotency-key': key },
    }),

  /** The open cellar up close, as the explore view of a little room. */
  view: (mapId: string, communityId: string): Promise<CellarView> =>
    apiCallFor(`/maps/${mapId}/communities/${communityId}/cellar`, {
      method: 'GET',
      schema: CellarViewSchema,
    }),

  /** Searches one cellar spot; the server rolls what's found (CLAUDE.md rule 1). */
  search: (
    mapId: string,
    communityId: string,
    spot: number,
    key: string,
  ): Promise<SearchSpotResponse> =>
    apiCallFor(`/maps/${mapId}/communities/${communityId}/cellar/search`, {
      method: 'POST',
      body: { spot },
      schema: SearchSpotResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type CellarApi = typeof cellarApi;
