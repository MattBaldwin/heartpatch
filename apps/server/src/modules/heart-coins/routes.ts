import {
  DevGrantHeartCoinsRequestSchema,
  HeartCoinsResponseSchema,
  MapIdParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { HEART_COINS_RATE_LIMITS } from './limits.js';
import type { HeartCoinsService } from './service.js';

export interface HeartCoinsRoutesOptions {
  hooks: AuthHooks;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also registers `POST /maps/:mapId/dev/heart-coins`,
   * which hands the player Heart Coins on a patch. Never in production
   * (`config.ts` refuses it there).
   */
  devGrants: boolean;
}

/** Heart Coins (#601): my balance on a patch. */
export const heartCoinsRoutes =
  (service: HeartCoinsService, options: HeartCoinsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'heart-coins', HEART_COINS_RATE_LIMITS);

    app.get(
      '/maps/:mapId/heart-coins',
      {
        schema: { params: MapIdParamsSchema, response: { 200: HeartCoinsResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        heartCoins: await service.get(requireUser(request), request.params.mapId),
      }),
    );

    if (options.devGrants) {
      app.post(
        '/maps/:mapId/dev/heart-coins',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevGrantHeartCoinsRequestSchema,
            response: { 201: HeartCoinsResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) => {
          const heartCoins = await service.devGrant(
            requireUser(request),
            request.params.mapId,
            request.body.amount,
          );
          return reply.code(201).send({ heartCoins });
        },
      );
    }

    done();
  };
