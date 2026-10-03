import {
  MapIdParamsSchema,
  PickStarterRequestSchema,
  SquishyResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { STARTER_RATE_LIMITS } from './limits.js';
import type { StartersService } from './service.js';

export interface StartersRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const startersRoutes =
  (service: StartersService, options: StartersRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const limit = playerRateLimit(fastify, 'starter', STARTER_RATE_LIMITS);

    app.post(
      '/maps/:mapId/starter',
      {
        schema: {
          params: MapIdParamsSchema,
          body: PickStarterRequestSchema,
          response: { 201: SquishyResponseSchema },
        },
        preHandler: [requireAuth, limit('pick'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const squishy = await service.pick(
          requireUser(request),
          request.params.mapId,
          request.body.speciesId,
        );
        return reply.code(201).send({ squishy });
      },
    );

    done();
  };
