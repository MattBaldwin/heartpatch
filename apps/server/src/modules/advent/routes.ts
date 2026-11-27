import {
  AdventViewSchema,
  ClaimAdventRequestSchema,
  ClaimAdventResponseSchema,
  MapIdParamsSchema,
  OpenPresentResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { ADVENT_RATE_LIMITS } from './limits.js';
import type { AdventService } from './service.js';

export interface AdventRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/**
 * Advent presents (#37 1c): `GET /maps/:mapId/advent` (this year's calendar),
 * `POST /maps/:mapId/advent/claim { day }` (open today's present, or one
 * missed day a day; `Idempotency-Key`) and `POST /maps/:mapId/presents/open`
 * (open one wrapped present from my bag; `Idempotency-Key`). Multiplayer
 * patches only.
 */
export const adventRoutes =
  (service: AdventService, options: AdventRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'advent', ADVENT_RATE_LIMITS);

    app.get(
      '/maps/:mapId/advent',
      {
        schema: { params: MapIdParamsSchema, response: { 200: AdventViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/advent/claim',
      {
        schema: {
          params: MapIdParamsSchema,
          body: ClaimAdventRequestSchema,
          response: { 200: ClaimAdventResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('claim'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.claim(requireUser(request), request.params.mapId, request.body.day),
    );

    app.post(
      '/maps/:mapId/presents/open',
      {
        schema: { params: MapIdParamsSchema, response: { 200: OpenPresentResponseSchema } },
        preHandler: [requireAuth, rateLimit('open'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.openPresent(requireUser(request), request.params.mapId),
    );

    done();
  };
