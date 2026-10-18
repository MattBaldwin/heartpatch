import {
  GlimmerSwapRequestSchema,
  GlimmerSwapResponseSchema,
  MapIdParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { GLIMMER_SWAP_RATE_LIMITS } from './limits.js';
import type { GlimmerSwapService } from './service.js';

export interface GlimmerSwapRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`): a retried swap never swaps twice. */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** The trading post's Glimmer swap (#523). */
export const glimmerSwapRoutes =
  (service: GlimmerSwapService, options: GlimmerSwapRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'glimmer-swap', GLIMMER_SWAP_RATE_LIMITS);

    app.get(
      '/maps/:mapId/glimmer-swap',
      {
        schema: { params: MapIdParamsSchema, response: { 200: GlimmerSwapResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => ({
        swap: await service.view(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/glimmer-swap',
      {
        schema: {
          params: MapIdParamsSchema,
          body: GlimmerSwapRequestSchema,
          response: { 200: GlimmerSwapResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('swap'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        swap: await service.swap(requireUser(request), request.params.mapId, request.body),
      }),
    );

    done();
  };
