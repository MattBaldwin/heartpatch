import { WardrobeResponseSchema, type SavePresetRequest, type Wardrobe } from '@heartpatch/shared';
import { apiCallFor } from '../../net/api.js';

/** The wardrobe's calls to `/api/v1/wardrobe` (server: modules/wardrobe/routes.ts). */
export const wardrobeApi = {
  get: async (): Promise<Wardrobe> =>
    (await apiCallFor('/wardrobe', { method: 'GET', schema: WardrobeResponseSchema })).wardrobe,

  /** Wears exactly `wearing`. `key` makes a retry on a flaky connection safe (tech spec §5). */
  wear: async (wearing: readonly string[], key: string): Promise<Wardrobe> =>
    (
      await apiCallFor('/wardrobe/wear', {
        method: 'POST',
        body: { wearing },
        schema: WardrobeResponseSchema,
        headers: { 'idempotency-key': key },
      })
    ).wardrobe,

  savePreset: async (preset: number, body: SavePresetRequest, key: string): Promise<Wardrobe> =>
    (
      await apiCallFor(`/wardrobe/presets/${String(preset)}`, {
        method: 'POST',
        body,
        schema: WardrobeResponseSchema,
        headers: { 'idempotency-key': key },
      })
    ).wardrobe,

  wearPreset: async (preset: number, key: string): Promise<Wardrobe> =>
    (
      await apiCallFor(`/wardrobe/presets/${String(preset)}/wear`, {
        method: 'POST',
        schema: WardrobeResponseSchema,
        headers: { 'idempotency-key': key },
      })
    ).wardrobe,

  /** Dev builds only (server `HP_DEV_SQUISHY_GRANTS`): a few pieces to try on. */
  devGrant: async (items: readonly string[]): Promise<Wardrobe> =>
    (
      await apiCallFor('/dev/wardrobe/items', {
        method: 'POST',
        body: { items },
        schema: WardrobeResponseSchema,
      })
    ).wardrobe,
};

export type WardrobeApi = typeof wardrobeApi;
