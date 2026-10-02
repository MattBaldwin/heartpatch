import {
  AttackTileRequestSchema,
  BattleResponseSchema,
  MapIdParamsSchema,
  SetDefendersRequestSchema,
  TerritoryResponseSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { TERRITORY_RATE_LIMITS, type TerritoryAction } from './limits.js';
import type { TerritoryService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface TerritoryRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const territoryRoutes =
  (service: TerritoryService, options: TerritoryRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: TerritoryAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = TERRITORY_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `territory:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `territory:${action}:user:${requireUser(request).id}`),
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
      '/maps/:mapId/territory',
      {
        schema: { params: MapIdParamsSchema, response: { 200: TerritoryResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        territory: await service.status(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/attacks',
      {
        schema: {
          params: MapIdParamsSchema,
          body: AttackTileRequestSchema,
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('attack'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.attack(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    app.post(
      '/maps/:mapId/defenders',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetDefendersRequestSchema,
          response: { 200: TerritoryResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('defenders'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        territory: await service.setDefenders(
          requireUser(request),
          request.params.mapId,
          request.body,
        ),
      }),
    );

    done();
  };
