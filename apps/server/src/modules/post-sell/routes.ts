import {
  MapIdParamsSchema,
  SellRequestSchema,
  SellResponseSchema,
  SellViewResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { POST_SELL_RATE_LIMITS } from './limits.js';
import type { PostSellService } from './service.js';

export interface PostSellRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`): a retried sale never sells twice. */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Selling extras to the trading post for Heart Coins (#601 PR 3). */
export const postSellRoutes =
  (service: PostSellService, options: PostSellRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'post-sell', POST_SELL_RATE_LIMITS);

    app.get(
      '/maps/:mapId/posts/sell',
      {
        schema: { params: MapIdParamsSchema, response: { 200: SellViewResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => ({
        sell: await service.view(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/posts/sell',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SellRequestSchema,
          response: { 200: SellResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('sell'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.sell(requireUser(request), request.params.mapId, request.body),
    );

    done();
  };
