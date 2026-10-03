import {
  MapIdParamsSchema,
  MarkRaidsSeenRequestSchema,
  RaidParamsSchema,
  RaidReplayResponseSchema,
  RaidReportResponseSchema,
  SetDefenseStyleRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { RAID_RATE_LIMITS } from './limits.js';
import type { RaidsService } from './service.js';

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

    const rateLimit = playerRateLimit(fastify, 'raids', RAID_RATE_LIMITS);

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
