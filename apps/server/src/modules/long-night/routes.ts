import {
  LongNightResponseSchema,
  MapIdParamsSchema,
  SetLongNightRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { LONG_NIGHT_RATE_LIMITS } from './limits.js';
import type { LongNightService } from './service.js';

export interface LongNightRoutesOptions {
  hooks: AuthHooks;
}

export const longNightRoutes =
  (service: LongNightService, options: LongNightRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'long-night', LONG_NIGHT_RATE_LIMITS);

    // The owner picks the patch's Long Night weekday, or Off (#727).
    app.post(
      '/maps/:mapId/long-night',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetLongNightRequestSchema,
          response: { 200: LongNightResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('owner')],
      },
      async (request) => ({
        longNightWeekday: await service.setWeekday(
          requireUser(request),
          request.params.mapId,
          request.body.weekday,
        ),
      }),
    );

    done();
  };
