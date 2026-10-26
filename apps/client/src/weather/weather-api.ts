import { WeatherViewSchema, type WeatherView } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The weather call (server: modules/weather). Wild Isle only; a Cozy Patch answers NOT_FOUND. */
export const weatherApi = {
  get: (mapId: string): Promise<WeatherView> =>
    apiCallFor(`/maps/${mapId}/weather`, { method: 'GET', schema: WeatherViewSchema }),
};

export type WeatherApi = typeof weatherApi;
