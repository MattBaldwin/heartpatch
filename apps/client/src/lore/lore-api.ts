import { LorebookResponseSchema, type LorePage } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The Lorebook's call (server: modules/lore). Only found pages come back. */
export const loreApi = {
  pages: async (): Promise<LorePage[]> =>
    (await apiCallFor('/lore', { method: 'GET', schema: LorebookResponseSchema })).pages,
};

export type LoreApi = typeof loreApi;
