import { MapIdParamsSchema, SettleResponseSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { SETTLE_RATE_LIMITS } from './limits.js';
import type { SettleService } from './service.js';

export interface SettleRoutesOptions {
  hooks: AuthHooks;
}

export const settleRoutes =
  (service: SettleService, options: SettleRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'settle', SETTLE_RATE_LIMITS);

    // Banks what has finished (owner decision 2026-10-06). A POST, not part
    // of `GET /inventory`, so reads stay free of side effects. Settling is
    // safe to repeat, so it needs no Idempotency-Key: a retry banks nothing new.
    app.post(
      '/maps/:mapId/settle',
      {
        schema: { params: MapIdParamsSchema, response: { 200: SettleResponseSchema } },
        preHandler: [requireAuth, rateLimit('settle')],
      },
      async (request) => service.settle(requireUser(request), request.params.mapId),
    );

    done();
  };
