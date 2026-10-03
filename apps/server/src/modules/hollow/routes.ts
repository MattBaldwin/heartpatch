import {
  BattleResponseSchema,
  DevNightfallResponseSchema,
  HollowResponseSchema,
  MapIdParamsSchema,
  StartRescueRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { HOLLOW_RATE_LIMITS } from './limits.js';
import type { HollowService } from './service.js';

export interface HollowRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** Dev/test only (`HP_DEV_SQUISHY_GRANTS`): the route that makes night fall now. */
  devTools?: boolean;
}

export const hollowRoutes =
  (service: HollowService, options: HollowRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const rateLimit = playerRateLimit(fastify, 'hollow', HOLLOW_RATE_LIMITS);

    app.get(
      '/maps/:mapId/hollow',
      {
        schema: { params: MapIdParamsSchema, response: { 200: HollowResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        hollow: await service.status(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/rescues',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartRescueRequestSchema,
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('rescue'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.rescue(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/nightfall',
        {
          schema: { params: MapIdParamsSchema, response: { 200: DevNightfallResponseSchema } },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) => service.devNightfall(requireUser(request), request.params.mapId),
      );
    }

    done();
  };
