import {
  KeeperResponseSchema,
  SetKeeperRequestSchema,
  SetKeeperResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { KEEPER_RATE_LIMITS } from './limits.js';
import type { KeepersService } from './service.js';

export interface KeepersRoutesOptions {
  hooks: AuthHooks;
}

export const keepersRoutes =
  (service: KeepersService, options: KeepersRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    const rateLimit = playerRateLimit(fastify, 'keeper', KEEPER_RATE_LIMITS);

    app.get(
      '/keeper',
      { schema: { response: { 200: KeeperResponseSchema } }, preHandler: requireAuth },
      async (request) => ({ keeper: await service.get(requireUser(request)) }),
    );

    app.post(
      '/keeper',
      {
        schema: { body: SetKeeperRequestSchema, response: { 200: SetKeeperResponseSchema } },
        preHandler: [requireAuth, rateLimit('save')],
      },
      async (request) => ({ keeper: await service.save(requireUser(request), request.body) }),
    );

    done();
  };
