import {
  ClearResponseSchema,
  MapIdParamsSchema,
  StartClearRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { CLEARING_RATE_LIMITS } from './limits.js';
import type { ClearingService } from './service.js';

export interface ClearingRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const clearingRoutes =
  (service: ClearingService, options: ClearingRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'clearing', CLEARING_RATE_LIMITS);

    // Clear a homestead of mine (#242). Finished clears land in the next settle.
    app.post(
      '/maps/:mapId/clears',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartClearRequestSchema,
          response: { 201: ClearResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('clear'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.start(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(201).send(result);
      },
    );

    done();
  };
