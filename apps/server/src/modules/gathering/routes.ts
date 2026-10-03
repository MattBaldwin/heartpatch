import {
  CollectResponseSchema,
  GatherParamsSchema,
  GatherResponseSchema,
  MapIdParamsSchema,
  StartGatherRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { GATHERING_RATE_LIMITS } from './limits.js';
import type { GatheringService } from './service.js';

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

    const rateLimit = playerRateLimit(fastify, 'gathering', GATHERING_RATE_LIMITS);

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
