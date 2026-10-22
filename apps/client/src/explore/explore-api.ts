import {
  ExploreTileResponseSchema,
  SearchSpotResponseSchema,
  SolvePuzzleResponseSchema,
  StartPuzzleResponseSchema,
  TellStoryResponseSchema,
  type ExploreTileResponse,
  type SearchSpotResponse,
  type SolvePuzzleRequest,
  type SolvePuzzleResponse,
  type StartPuzzleRequest,
  type StartPuzzleResponse,
  type TellStoryRequest,
  type TellStoryResponse,
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

  /** A new try at a grey village tile's Relight puzzle (#306 PR 2b): a fresh path every time. */
  puzzleStart: (mapId: string, body: StartPuzzleRequest): Promise<StartPuzzleResponse> =>
    apiCallFor(`/maps/${mapId}/explore/puzzle/start`, {
      method: 'POST',
      body,
      schema: StartPuzzleResponseSchema,
    }),

  /** Sends a try's moves (#306 PR 2b); the server replays them, checks the light and rolls. */
  puzzle: (mapId: string, body: SolvePuzzleRequest, key: string): Promise<SolvePuzzleResponse> =>
    apiCallFor(`/maps/${mapId}/explore/puzzle`, {
      method: 'POST',
      body,
      schema: SolvePuzzleResponseSchema,
      headers: { 'idempotency-key': key },
    }),
  /** Tells the heart tile's forgotten story (#306): whole again, or smudged and dealt anew. */
  story: (mapId: string, body: TellStoryRequest, key: string): Promise<TellStoryResponse> =>
    apiCallFor(`/maps/${mapId}/explore/puzzle/story`, {
      method: 'POST',
      body,
      schema: TellStoryResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type ExploreApi = typeof exploreApi;
