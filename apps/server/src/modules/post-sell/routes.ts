import {
  AnySellRequestSchema,
  AnySellResponseSchema,
  MapIdParamsSchema,
  SellViewResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { POST_SELL_RATE_LIMITS } from './limits.js';
import { legacyBasket, type PostSellService } from './service.js';

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
          body: AnySellRequestSchema,
          response: { 200: AnySellResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('sell'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => {
        const user = requireUser(request);
        const { body } = request;
        if (body.kind === 'basket') return service.sellBasket(user, request.params.mapId, body);
        // A legacy one-line sale (#655, one release; part E removes it): sold
        // as a one-line basket, answered in the old shape.
        const { sold, sell } = await service.sellBasket(
          user,
          request.params.mapId,
          legacyBasket(body),
        );
        const [line] = sold.lines;
        if (!line) throw new Error('post-sell: a one-line basket sold no line');
        return { sold: line, sell };
      },
    );

    done();
  };
