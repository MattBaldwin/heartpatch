import { LorebookResponseSchema, type LorebookResponse, type LorePage } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/**
 * The Lorebook's calls (server: modules/lore). Found pages come back in full;
 * every other page is only its place and hint (#307).
 */
export const loreApi = {
  pages: async (): Promise<LorePage[]> =>
    (await apiCallFor('/lore', { method: 'GET', schema: LorebookResponseSchema })).pages,
  book: (): Promise<LorebookResponse> =>
    apiCallFor('/lore', { method: 'GET', schema: LorebookResponseSchema }),
  /** These pages have been read in the book; replies with the book. */
  markRead: (ids: readonly string[]): Promise<LorebookResponse> =>
    apiCallFor('/lore/read', {
      method: 'POST',
      body: { ids: [...ids] },
      schema: LorebookResponseSchema,
    }),
};

export type LoreApi = typeof loreApi;
