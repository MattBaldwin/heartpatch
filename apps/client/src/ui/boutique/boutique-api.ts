import {
  BoutiqueResponseSchema,
  BuyClothingResponseSchema,
  CoinsResponseSchema,
  type Boutique,
  type BuyClothingResponse,
  type Coins,
} from '@heartpatch/shared';
import { apiCallFor } from '../../net/api.js';

/** Patch Coins and the Boutique (server: modules/coins and modules/boutique). */
export const boutiqueApi = {
  coins: async (): Promise<Coins> =>
    (await apiCallFor('/coins', { method: 'GET', schema: CoinsResponseSchema })).coins,

  get: async (): Promise<Boutique> =>
    (await apiCallFor('/boutique', { method: 'GET', schema: BoutiqueResponseSchema })).boutique,

  /** Buys one piece. `key` makes a retry on a flaky connection safe (tech spec §5). */
  buy: async (itemId: string, key: string): Promise<BuyClothingResponse> =>
    apiCallFor('/boutique/buy', {
      method: 'POST',
      body: { itemId },
      schema: BuyClothingResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Dev builds only (server `HP_DEV_SQUISHY_GRANTS`): coins to try the Boutique with. */
  devGrant: async (amount: number): Promise<Coins> =>
    (
      await apiCallFor('/dev/coins', {
        method: 'POST',
        body: { amount },
        schema: CoinsResponseSchema,
      })
    ).coins,
};

export type BoutiqueApi = typeof boutiqueApi;
