import {
  FuelAllResponseSchema,
  HomeResponseSchema,
  RemoveBuildingResponseSchema,
  type FuelAllResponse,
  type HomeResponse,
  type RemoveBuildingResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The home-base calls (server: modules/buildings). `key` makes a retry safe (tech spec §5). */
export const homeApi = {
  get: (mapId: string): Promise<HomeResponse> =>
    apiCallFor(`/maps/${mapId}/home`, { method: 'GET', schema: HomeResponseSchema }),

  place: (
    mapId: string,
    body: { buildingId: string; q: number; r: number; spot: number },
    key: string,
  ): Promise<HomeResponse> =>
    apiCallFor(`/maps/${mapId}/buildings`, {
      method: 'POST',
      body,
      schema: HomeResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  move: (
    mapId: string,
    buildingId: string,
    to: { q: number; r: number; spot: number },
    key: string,
  ): Promise<HomeResponse> =>
    apiCallFor(`/maps/${mapId}/buildings/${buildingId}/move`, {
      method: 'POST',
      body: to,
      schema: HomeResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  remove: (mapId: string, buildingId: string, key: string): Promise<RemoveBuildingResponse> =>
    apiCallFor(`/maps/${mapId}/buildings/${buildingId}/remove`, {
      method: 'POST',
      schema: RemoveBuildingResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  fuel: (mapId: string, buildingId: string, nights: number, key: string): Promise<HomeResponse> =>
    apiCallFor(`/maps/${mapId}/buildings/${buildingId}/fuel`, {
      method: 'POST',
      body: { nights },
      schema: HomeResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Tops up every fire, lowest first, until full or the bag runs out (#202). */
  fuelAll: (mapId: string, key: string): Promise<FuelAllResponse> =>
    apiCallFor(`/maps/${mapId}/buildings/fuel-all`, {
      method: 'POST',
      schema: FuelAllResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** Raises a building a level (owner decision 2026-10-06). */
  upgrade: (mapId: string, buildingId: string, key: string): Promise<HomeResponse> =>
    apiCallFor(`/maps/${mapId}/buildings/${buildingId}/upgrade`, {
      method: 'POST',
      schema: HomeResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  house: (
    mapId: string,
    squishyId: string,
    habitatId: string | null,
    key: string,
  ): Promise<HomeResponse> =>
    apiCallFor(`/maps/${mapId}/squishies/${squishyId}/habitat`, {
      method: 'POST',
      body: { habitatId },
      schema: HomeResponseSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type HomeApi = typeof homeApi;
