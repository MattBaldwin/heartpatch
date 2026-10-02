import {
  MapIdParamsSchema,
  MarkRaidsSeenRequestSchema,
  RaidParamsSchema,
  RaidReplayResponseSchema,
  RaidReportResponseSchema,
  SetDefenseStyleRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { RAID_RATE_LIMITS, type RaidAction } from './limits.js';
import type { RaidsService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface RaidsRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const raidsRoutes =
  (service: RaidsService, options: RaidsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: RaidAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = RAID_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `raids:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `raids:${action}:user:${requireUser(request).id}`),
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
      '/maps/:mapId/raids',
      {
        schema: { params: MapIdParamsSchema, response: { 200: RaidReportResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => ({
        report: await service.report(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/raids/seen',
      {
        schema: {
          params: MapIdParamsSchema,
          body: MarkRaidsSeenRequestSchema,
          response: { 200: RaidReportResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('write'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        report: await service.markSeen(requireUser(request), request.params.mapId, request.body),
      }),
    );

    app.get(
      '/maps/:mapId/raids/:raidId/replay',
      {
        schema: { params: RaidParamsSchema, response: { 200: RaidReplayResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => ({
        replay: await service.replay(
          requireUser(request),
          request.params.mapId,
          request.params.raidId,
        ),
      }),
    );

    app.post(
      '/maps/:mapId/defense-style',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetDefenseStyleRequestSchema,
          response: { 200: RaidReportResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('write'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        report: await service.setStyle(requireUser(request), request.params.mapId, request.body),
      }),
    );

    done();
  };
