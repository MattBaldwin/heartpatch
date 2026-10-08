import {
  BuildFenceRequestSchema,
  FenceParamsSchema,
  FenceTileResponseSchema,
  MapIdParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { FENCES_RATE_LIMITS } from './limits.js';
import type { FencesService } from './service.js';

export interface FencesRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Fences on the edges of my land (#203). */
export const fencesRoutes =
  (service: FencesService, options: FencesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'fences', FENCES_RATE_LIMITS);
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('fence'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.post(
      '/maps/:mapId/fences',
      {
        schema: {
          params: MapIdParamsSchema,
          body: BuildFenceRequestSchema,
          response: { 201: FenceTileResponseSchema },
        },
        ...commandHooks,
      },
      async (request, reply) => {
        const tile = await service.build(requireUser(request), request.params.mapId, request.body);
        return reply.code(201).send(tile);
      },
    );

    for (const action of ['upgrade', 'repair', 'remove'] as const) {
      app.post(
        `/maps/:mapId/fences/:fenceId/${action}`,
        {
          schema: { params: FenceParamsSchema, response: { 200: FenceTileResponseSchema } },
          ...commandHooks,
        },
        async (request) =>
          service[action](requireUser(request), request.params.mapId, request.params.fenceId),
      );
    }

    done();
  };
