import {
  CellarViewSchema,
  CommunityViewSchema,
  SearchSpotResponseSchema,
  type CellarView,
  type CommunityView,
  type SearchSpotResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The key hunt and the hidden cellar (#306 PR 2c; server: modules/communities/cellar). `key` makes a retry safe. */
export const cellarApi = {
  /** Dig the cellar key up on the tile the village's map points to. */
  dig: (mapId: string, communityId: string, key: string): Promise<CommunityView> =>
    apiCallFor(`/maps/${mapId}/communities/${communityId}/key`, {
      method: 'POST',
      schema: CommunityViewSchema,
      headers: { 'idempotency-key': key },
    }),

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
