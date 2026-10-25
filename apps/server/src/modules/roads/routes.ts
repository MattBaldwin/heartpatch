import {
  MapIdParamsSchema,
  RoadRequestSchema,
  RoadsViewSchema,
  RoadTileResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { ROADS_RATE_LIMITS } from './limits.js';
import type { RoadsService } from './service.js';

export interface RoadsRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Roads on my Wild Isle land (#621). Cozy Patches answer `NOT_FOUND`. */
export const roadsRoutes =
  (service: RoadsService, options: RoadsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'roads', ROADS_RATE_LIMITS);
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('road'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/roads',
      {
        schema: { params: MapIdParamsSchema, response: { 200: RoadsViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/roads',
      {
        schema: {
          params: MapIdParamsSchema,
          body: RoadRequestSchema,
          response: { 201: RoadTileResponseSchema },
        },
        ...commandHooks,
      },
      async (request, reply) => {
        const tile = await service.build(requireUser(request), request.params.mapId, request.body);
        return reply.code(201).send(tile);
      },
    );

    for (const action of ['upgrade', 'remove'] as const) {
      app.post(
        `/maps/:mapId/roads/${action}`,
        {
          schema: {
            params: MapIdParamsSchema,
            body: RoadRequestSchema,
            response: { 200: RoadTileResponseSchema },
          },
          ...commandHooks,
        },
        async (request) =>
          service[action](requireUser(request), request.params.mapId, request.body),
      );
    }

    done();
  };
