import {
  BoutiqueResponseSchema,
  BuyClothingRequestSchema,
  BuyClothingResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { BOUTIQUE_RATE_LIMITS } from './limits.js';
import type { BoutiqueService } from './service.js';

export interface BoutiqueRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`): a retried purchase never buys twice. */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const boutiqueRoutes =
  (service: BoutiqueService, options: BoutiqueRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'boutique', BOUTIQUE_RATE_LIMITS);

    app.get(
      '/boutique',
      { schema: { response: { 200: BoutiqueResponseSchema } }, preHandler: requireAuth },
      async (request) => ({ boutique: await service.get(requireUser(request)) }),
    );

    app.post(
      '/boutique/buy',
      {
        schema: { body: BuyClothingRequestSchema, response: { 200: BuyClothingResponseSchema } },
        preHandler: [requireAuth, rateLimit('buy'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.buy(requireUser(request), request.body.itemId),
    );

    done();
  };
