import {
  ExploreTileResponseSchema,
  SearchSpotResponseSchema,
  type ExploreTileResponse,
  type SearchSpotResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Exploring your land (server: modules/explore). `key` makes a retry safe (tech spec §5). */
export const exploreApi = {
  /** One of my tiles up close: its search spots and which are done. */
  tile: (mapId: string, at: { q: number; r: number }): Promise<ExploreTileResponse> =>
    apiCallFor(`/maps/${mapId}/explore?q=${String(at.q)}&r=${String(at.r)}`, {
      method: 'GET',
      schema: ExploreTileResponseSchema,
    }),

  /** Searches one spot; the server rolls what's found (CLAUDE.md rule 1). */
  search: (
    mapId: string,
    body: { q: number; r: number; spot: number },
    key: string,
  ): Promise<SearchSpotResponse> =>
    apiCallFor(`/maps/${mapId}/explore/search`, {
      method: 'POST',
      body,
      schema: SearchSpotResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type ExploreApi = typeof exploreApi;
