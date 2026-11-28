import {
  MapIdParamsSchema,
  LineRequestSchema,
  LinesViewSchema,
  LineTileResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { LINES_RATE_LIMITS } from './limits.js';
import type { LinesService } from './service.js';

export interface LinesRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Wires and rails on my Clockwork Isle land (#874). Every other patch type answers `NOT_FOUND`. */
export const linesRoutes =
  (service: LinesService, options: LinesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'lines', LINES_RATE_LIMITS);
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('line'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/lines',
      {
        schema: { params: MapIdParamsSchema, response: { 200: LinesViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/lines',
      {
        schema: {
          params: MapIdParamsSchema,
          body: LineRequestSchema,
          response: { 201: LineTileResponseSchema },
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
        `/maps/:mapId/lines/${action}`,
        {
          schema: {
            params: MapIdParamsSchema,
            body: LineRequestSchema,
            response: { 200: LineTileResponseSchema },
          },
          ...commandHooks,
        },
        async (request) =>
          service[action](requireUser(request), request.params.mapId, request.body),
      );
    }

    done();
  };
