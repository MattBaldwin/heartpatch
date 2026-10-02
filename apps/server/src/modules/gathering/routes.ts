import {
  CollectResponseSchema,
  GatherParamsSchema,
  GatherResponseSchema,
  MapIdParamsSchema,
  StartGatherRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { GATHERING_RATE_LIMITS, type GatheringAction } from './limits.js';
import type { GatheringService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface GatheringRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const gatheringRoutes =
  (service: GatheringService, options: GatheringRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: GatheringAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = GATHERING_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `gathering:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `gathering:${action}:user:${requireUser(request).id}`),
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

    app.post(
      '/maps/:mapId/gathers',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartGatherRequestSchema,
          response: { 201: GatherResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('gather'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.start(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(201).send(result);
      },
    );

    app.post(
      '/maps/:mapId/gathers/:gatherId/collect',
      {
        schema: { params: GatherParamsSchema, response: { 200: CollectResponseSchema } },
        preHandler: [requireAuth, rateLimit('gather'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.collect(requireUser(request), request.params.mapId, request.params.gatherId),
    );

    done();
  };
