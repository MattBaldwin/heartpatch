import {
  CareListResponseSchema,
  CareRequestSchema,
  CareResponseSchema,
  MapIdParamsSchema,
  SquishyParamsSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { CARE_RATE_LIMITS, type CareRateAction } from './limits.js';
import type { CareService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface CareRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const careRoutes =
  (service: CareService, options: CareRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: CareRateAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = CARE_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `care:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `care:${action}:user:${requireUser(request).id}`),
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
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('care'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/care',
      {
        schema: { params: MapIdParamsSchema, response: { 200: CareListResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.list(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/care',
      {
        schema: {
          params: SquishyParamsSchema,
          body: CareRequestSchema,
          response: { 200: CareResponseSchema },
        },
        ...commandHooks,
      },
      async (request) =>
        service.care(
          requireUser(request),
          request.params.mapId,
          request.params.squishyId,
          request.body.action,
        ),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/care/seen',
      {
        schema: { params: SquishyParamsSchema, response: { 200: CareListResponseSchema } },
        ...commandHooks,
      },
      async (request) =>
        service.seen(requireUser(request), request.params.mapId, request.params.squishyId),
    );

    done();
  };
