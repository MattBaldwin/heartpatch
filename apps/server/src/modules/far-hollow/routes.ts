import {
  FarHollowSearchRequestSchema,
  FarHollowSearchResponseSchema,
  FarHollowTileParamsSchema,
  FarHollowTileViewSchema,
  FarHollowViewSchema,
  MapIdParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { FAR_HOLLOW_RATE_LIMITS } from './limits.js';
import type { FarHollowService } from './service.js';

export interface FarHollowRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** `HP_DEV_SQUISHY_GRANTS`: also the dev route that arrives without the far road. Never in production. */
  devTools?: boolean;
}

/** The far Hollow (#306 PR 6): my own this season, a tile up close, and searching it. The far road itself is a journey (modules/journeys). */
export const farHollowRoutes =
  (service: FarHollowService, options: FarHollowRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'far-hollow', FAR_HOLLOW_RATE_LIMITS);

    app.get(
      '/maps/:mapId/far-hollow',
      {
        schema: { params: MapIdParamsSchema, response: { 200: FarHollowViewSchema } },
        preHandler: [requireAuth, rateLimit('farHollow')],
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.get(
      '/maps/:mapId/far-hollow/tiles/:index',
      {
        schema: { params: FarHollowTileParamsSchema, response: { 200: FarHollowTileViewSchema } },
        preHandler: [requireAuth, rateLimit('farHollow')],
      },
      async (request) =>
        service.tile(requireUser(request), request.params.mapId, request.params.index),
    );

    // Search one spot (one transaction; send an Idempotency-Key).
    app.post(
      '/maps/:mapId/far-hollow/search',
      {
        schema: {
          params: MapIdParamsSchema,
          body: FarHollowSearchRequestSchema,
          response: { 200: FarHollowSearchResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('farHollow'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.search(requireUser(request), request.params.mapId, request.body),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/far-hollow',
        {
          schema: {
            params: MapIdParamsSchema,
            body: z.strictObject({ nearlyDone: z.boolean().default(false) }),
            response: { 201: FarHollowViewSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) =>
          reply
            .code(201)
            .send(
              await service.devArrive(
                requireUser(request),
                request.params.mapId,
                request.body.nearlyDone,
              ),
            ),
      );
    }

    done();
  };
