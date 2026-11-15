import {
  BattleIdParamsSchema,
  BattleResponseSchema,
  BossBefriendRequestSchema,
  BossBefriendResponseSchema,
  BossVisitResponseSchema,
  MapIdParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { BOSS_RATE_LIMITS } from './limits.js';
import type { BossService } from './service.js';

export interface BossRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const bossRoutes =
  (service: BossService, options: BossRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'boss', BOSS_RATE_LIMITS);

    // This week's mini-boss as I see it (#190), or null: never the schedule.
    app.get(
      '/maps/:mapId/boss',
      {
        schema: { params: MapIdParamsSchema, response: { 200: BossVisitResponseSchema } },
        preHandler: [requireAuth, rateLimit('view')],
      },
      async (request) => ({
        boss: await service.current(requireUser(request), request.params.mapId),
      }),
    );

    // Fight it (#190): the intent alone; the server builds the boss. The
    // reply is the battle, as any battle's start; turns go through
    // `POST /battles/:battleId/actions` as always.
    app.post(
      '/maps/:mapId/boss/battle',
      {
        schema: {
          params: MapIdParamsSchema,
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('battle'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.start(requireUser(request), request.params.mapId);
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    // Ask a beaten boss to be your friend (#190 plan §3): the ask number
    // alone; the server spends the charms and rolls. Never the odds.
    app.post(
      '/battles/:battleId/befriend',
      {
        schema: {
          params: BattleIdParamsSchema,
          body: BossBefriendRequestSchema,
          response: { 200: BossBefriendResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('befriend'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.befriend(requireUser(request), request.params.battleId, request.body.ask),
    );

    done();
  };
