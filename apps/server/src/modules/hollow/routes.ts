import {
  BattleResponseSchema,
  DevNightfallResponseSchema,
  HollowResponseSchema,
  MapIdParamsSchema,
  StartRescueRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { HOLLOW_RATE_LIMITS, type HollowAction } from './limits.js';
import type { HollowService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface HollowRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** Dev/test only (`HP_DEV_SQUISHY_GRANTS`): the route that makes night fall now. */
  devTools?: boolean;
}

export const hollowRoutes =
  (service: HollowService, options: HollowRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: HollowAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = HOLLOW_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `hollow:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `hollow:${action}:user:${requireUser(request).id}`),
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
      '/maps/:mapId/hollow',
      {
        schema: { params: MapIdParamsSchema, response: { 200: HollowResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        hollow: await service.status(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/rescues',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartRescueRequestSchema,
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('rescue'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.rescue(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/nightfall',
        {
          schema: { params: MapIdParamsSchema, response: { 200: DevNightfallResponseSchema } },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) => service.devNightfall(requireUser(request), request.params.mapId),
      );
    }

    done();
  };
