import {
  DevKnockRequestSchema,
  DevWeatherRequestSchema,
  MapIdParamsSchema,
  WeatherViewSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { WEATHER_RATE_LIMITS } from './limits.js';
import type { WeatherService } from './service.js';

export interface WeatherRoutesOptions {
  hooks: AuthHooks;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also registers `POST /maps/:mapId/dev/weather`
   * and `POST /maps/:mapId/dev/knock` (plan §9). Never in production
   * (`config.ts` refuses it there).
   */
  devTools?: boolean;
}

/** Wild Isle weather (#621). Cozy Patches answer `NOT_FOUND`. */
export const weatherRoutes =
  (service: WeatherService, options: WeatherRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    // A GET that stores today's and tomorrow's plans the first time anyone
    // asks: the same plan whoever asks first, so it's safe to repeat.
    app.get(
      '/maps/:mapId/weather',
      {
        schema: { params: MapIdParamsSchema, response: { 200: WeatherViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    if (options.devTools) {
      const rateLimit = playerRateLimit(fastify, 'weather', WEATHER_RATE_LIMITS);
      const devHooks = { preHandler: [requireAuth, rateLimit('dev')] };
      app.post(
        '/maps/:mapId/dev/weather',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevWeatherRequestSchema,
            response: { 200: WeatherViewSchema },
          },
          ...devHooks,
        },
        async (request) =>
          service.devWeather(requireUser(request), request.params.mapId, request.body),
      );
      app.post(
        '/maps/:mapId/dev/knock',
        { schema: { params: MapIdParamsSchema, body: DevKnockRequestSchema }, ...devHooks },
        async (request, reply) => {
          await service.devKnock(requireUser(request), request.params.mapId, request.body);
          return reply.code(204).send();
        },
      );
    }

    done();
  };
