import {
  BuyRequestSchema,
  BuyResponseSchema,
  MapIdParamsSchema,
  ShopQuerySchema,
  ShopViewResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { POST_SHOP_RATE_LIMITS } from './limits.js';
import type { PostShopService } from './service.js';

export interface PostShopRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`): a retried purchase never charges twice. */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** The trading post's Shop (#729): consumables for Heart Coins. */
export const postShopRoutes =
  (service: PostShopService, options: PostShopRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'post-shop', POST_SHOP_RATE_LIMITS);

    app.get(
      '/maps/:mapId/posts/shop',
      {
        schema: {
          params: MapIdParamsSchema,
          querystring: ShopQuerySchema,
          response: { 200: ShopViewResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => ({
        shop: await service.view(requireUser(request), request.params.mapId, request.query),
      }),
    );

    app.post(
      '/maps/:mapId/posts/shop',
      {
        schema: {
          params: MapIdParamsSchema,
          body: BuyRequestSchema,
          response: { 200: BuyResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('buy'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.buy(requireUser(request), request.params.mapId, request.body),
    );

    done();
  };
