import {
  CareListResponseSchema,
  CareResponseSchema,
  type CareListResponse,
  type CareResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The care calls (server: modules/care). `key` makes a retry safe (tech spec §5). */
export const careApi = {
  list: (mapId: string): Promise<CareListResponse> =>
    apiCallFor(`/maps/${mapId}/care`, { method: 'GET', schema: CareListResponseSchema }),

  care: (mapId: string, squishyId: string, action: string, key: string): Promise<CareResponse> =>
    apiCallFor(`/maps/${mapId}/squishies/${squishyId}/care`, {
      method: 'POST',
      body: { action },
      schema: CareResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  seen: (mapId: string, squishyId: string, key: string): Promise<CareListResponse> =>
    apiCallFor(`/maps/${mapId}/squishies/${squishyId}/care/seen`, {
      method: 'POST',
      schema: CareListResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** A new nickname, or null for the species name (#20's close-up). */
  rename: (
    mapId: string,
    squishyId: string,
    nickname: string | null,
    key: string,
  ): Promise<CareListResponse> =>
    apiCallFor(`/maps/${mapId}/squishies/${squishyId}/rename`, {
      method: 'POST',
      body: { nickname },
      schema: CareListResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type CareApi = typeof careApi;
