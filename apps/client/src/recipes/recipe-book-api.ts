import { RecipeBookResponseSchema, type RecipeBookResponse } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The recipe book's call (server: modules/inventory). Pages are account-wide, not per patch. */
export const recipeBookApi = {
  /** The page keys this account has opened. */
  get: (): Promise<RecipeBookResponse> =>
    apiCallFor('/recipe-book', { method: 'GET', schema: RecipeBookResponseSchema }),
};

export type RecipeBookApi = typeof recipeBookApi;
