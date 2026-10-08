import {
  FactoryQueueParamsSchema,
  FactoryQueueResponseSchema,
  InventoryResponseSchema,
  MapIdParamsSchema,
  StartFactoryQueueRequestSchema,
  StopFactoryQueueResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { FACTORY_RATE_LIMITS } from './limits.js';
import type { FactoryService } from './service.js';

export interface FactoryRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** `HP_DEV_SQUISHY_GRANTS`: also the dev route that finishes batches now. Never in production. */
  devTools: boolean;
}

export const factoryRoutes =
  (service: FactoryService, options: FactoryRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'factory', FACTORY_RATE_LIMITS);

    app.post(
      '/maps/:mapId/factory/queues',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartFactoryQueueRequestSchema,
          response: { 201: FactoryQueueResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('factory'), idempotency.preHandler],
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
      '/maps/:mapId/factory/queues/:queueId/stop',
      {
        schema: {
          params: FactoryQueueParamsSchema,
          response: { 200: StopFactoryQueueResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('factory'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.stop(requireUser(request), request.params.mapId, request.params.queueId),
    );

    if (options.devTools) {
      // Dev and test only: my batches finish now, so a phone or an e2e run
      // sees them land without the real wait.
      app.post(
        '/maps/:mapId/dev/factory/ready',
        {
          schema: { params: MapIdParamsSchema, response: { 200: InventoryResponseSchema } },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) => service.devReady(requireUser(request), request.params.mapId),
      );
    }

    done();
  };
