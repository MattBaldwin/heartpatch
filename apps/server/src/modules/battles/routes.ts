import {
  BattleActionRequestSchema,
  BattleIdParamsSchema,
  BattleResponseSchema,
  CurrentBattleResponseSchema,
  DevGrantSquishyRequestSchema,
  DevStartBattleRequestSchema,
  MapIdParamsSchema,
  SquishyResponseSchema,
  StartWildBattleRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { BATTLE_RATE_LIMITS, type BattleAction } from './limits.js';
import { devEncounter, type BattlesService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface BattlesRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support for action submits (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also register the dev routes that hand a player a
   * squishy and pick a fight with a chosen wild squishy. Never in production
   * (`config.ts` refuses it there).
   */
  devGrants: boolean;
}

export const battlesRoutes =
  (service: BattlesService, options: BattlesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: BattleAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = BATTLE_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `battles:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `battles:${action}:user:${requireUser(request).id}`),
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
      '/maps/:mapId/battles/current',
      {
        schema: { params: MapIdParamsSchema, response: { 200: CurrentBattleResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        battle: await service.current(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/battles',
      {
        schema: {
          params: MapIdParamsSchema,
          // Optional: with no body, the nearest wild squishy.
          body: StartWildBattleRequestSchema.nullish(),
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('start')],
      },
      async (request, reply) => {
        const result = await service.startWild(
          requireUser(request),
          request.params.mapId,
          request.body ?? {},
        );
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    app.get(
      '/battles/:battleId',
      {
        schema: { params: BattleIdParamsSchema, response: { 200: BattleResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        battle: await service.get(requireUser(request), request.params.battleId),
      }),
    );

    app.post(
      '/battles/:battleId/actions',
      {
        schema: {
          params: BattleIdParamsSchema,
          body: BattleActionRequestSchema,
          response: { 200: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('act'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        battle: await service.act(requireUser(request), request.params.battleId, request.body),
      }),
    );

    if (options.devGrants) {
      app.post(
        '/maps/:mapId/dev/squishies',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevGrantSquishyRequestSchema,
            response: { 201: SquishyResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) => {
          const squishy = await service.grantSquishy(
            requireUser(request),
            request.params.mapId,
            request.body,
          );
          return reply.code(201).send({ squishy });
        },
      );

      app.post(
        '/maps/:mapId/dev/battles',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevStartBattleRequestSchema,
            response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) => {
          const result = await service.startAgainst(
            requireUser(request),
            request.params.mapId,
            devEncounter(service, request.body.opponent),
          );
          return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
        },
      );
    }

    done();
  };
