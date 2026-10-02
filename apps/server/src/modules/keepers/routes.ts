import {
  KeeperResponseSchema,
  SetKeeperRequestSchema,
  SetKeeperResponseSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { KEEPER_RATE_LIMITS, type KeeperAction } from './limits.js';
import type { KeepersService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface KeepersRoutesOptions {
  hooks: AuthHooks;
}

export const keepersRoutes =
  (service: KeepersService, options: KeepersRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: KeeperAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = KEEPER_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `keeper:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `keeper:${action}:user:${requireUser(request).id}`),
      ];
      return async (request, reply) => {
        for (const check of checks) {
          const result = await check(request);
          if (!result.isAllowed && result.isExceeded) {
            void reply.header('retry-after', result.ttlInSeconds);
            throw new AppError('RATE_LIMITED', RATE_LIMITED_MESSAGE);
          }
        }
      };
    };

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
