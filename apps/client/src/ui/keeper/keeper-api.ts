import {
  KeeperResponseSchema,
  SetKeeperResponseSchema,
  type KeeperConfig,
} from '@heartpatch/shared';
import { apiCallFor } from '../../net/api.js';

/** The Keeper picker's calls to `/api/v1/keeper` (server: modules/keepers/routes.ts). */
export const keeperApi = {
  /** The player's Keeper, or null before they pick one. */
  get: async (): Promise<KeeperConfig | null> =>
    (await apiCallFor('/keeper', { method: 'GET', schema: KeeperResponseSchema })).keeper,

  save: async (body: KeeperConfig): Promise<KeeperConfig> =>
    (await apiCallFor('/keeper', { method: 'POST', body, schema: SetKeeperResponseSchema })).keeper,
};

export type KeeperApi = typeof keeperApi;
