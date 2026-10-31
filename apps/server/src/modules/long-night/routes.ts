import {
  BattleResponseSchema,
  LongNightResponseSchema,
  MapIdParamsSchema,
  SetLongNightRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { LONG_NIGHT_RATE_LIMITS } from './limits.js';
import type { LongNightService } from './service.js';

export interface LongNightRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const longNightRoutes =
  (service: LongNightService, options: LongNightRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'long-night', LONG_NIGHT_RATE_LIMITS);

    // The owner picks the patch's Long Night weekday, or Off (#727).
    app.post(
      '/maps/:mapId/long-night',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetLongNightRequestSchema,
          response: { 200: LongNightResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('owner')],
      },
      async (request) => ({
        longNightWeekday: await service.setWeekday(
          requireUser(request),
          request.params.mapId,
          request.body.weekday,
        ),
      }),
    );

    // My Juniper's Gap encounter (#727d): the intent alone; the server picks
    // the squishy. The reply is the battle, as any wild battle's start.
    app.post(
      '/maps/:mapId/long-night/gap-encounter',
      {
        schema: {
          params: MapIdParamsSchema,
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('gap'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.claimGap(requireUser(request), request.params.mapId);
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    done();
  };
