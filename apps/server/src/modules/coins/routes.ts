import { CoinsResponseSchema, DevGrantCoinsRequestSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { COINS_RATE_LIMITS } from './limits.js';
import type { CoinsService } from './service.js';

export interface CoinsRoutesOptions {
  hooks: AuthHooks;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also registers `POST /dev/coins`, which hands the
   * player Patch Coins. Never in production (`config.ts` refuses it there).
   */
  devGrants: boolean;
}

export const coinsRoutes =
  (service: CoinsService, options: CoinsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'coins', COINS_RATE_LIMITS);

    app.get(
      '/coins',
      { schema: { response: { 200: CoinsResponseSchema } }, preHandler: requireAuth },
      async (request) => ({ coins: await service.get(requireUser(request)) }),
    );

    if (options.devGrants) {
      app.post(
        '/dev/coins',
        {
          schema: { body: DevGrantCoinsRequestSchema, response: { 201: CoinsResponseSchema } },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) => {
          const coins = await service.devGrant(requireUser(request), request.body.amount);
          return reply.code(201).send({ coins });
        },
      );
    }

    done();
  };
