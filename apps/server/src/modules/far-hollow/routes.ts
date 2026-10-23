import { FarHollowViewSchema, MapIdParamsSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { FAR_HOLLOW_RATE_LIMITS } from './limits.js';
import type { FarHollowService } from './service.js';

export interface FarHollowRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** `HP_DEV_SQUISHY_GRANTS`: also the dev route that arrives without the far road. Never in production. */
  devTools?: boolean;
}

/** The far Hollow (#306 PR 6): my own this season (#306 6b adds the house's commands). The far road itself is a journey (modules/journeys). */
export const farHollowRoutes =
  (service: FarHollowService, options: FarHollowRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'far-hollow', FAR_HOLLOW_RATE_LIMITS);

    app.get(
      '/maps/:mapId/far-hollow',
      {
        schema: { params: MapIdParamsSchema, response: { 200: FarHollowViewSchema } },
        preHandler: [requireAuth, rateLimit('farHollow')],
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/far-hollow',
        {
          schema: {
            params: MapIdParamsSchema,
            response: { 201: FarHollowViewSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) =>
          reply.code(201).send(await service.devArrive(requireUser(request), request.params.mapId)),
      );
    }

    done();
  };
