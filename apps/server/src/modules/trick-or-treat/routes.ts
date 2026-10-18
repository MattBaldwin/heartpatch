import {
  MapIdParamsSchema,
  TrickOrTreatRequestSchema,
  TrickOrTreatResponseSchema,
  TrickOrTreatVisitResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { TRICK_OR_TREAT_RATE_LIMITS } from './limits.js';
import type { TrickOrTreatService } from './service.js';

export interface TrickOrTreatRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`): a retried knock replays the first reply. */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Trick-or-treat at patch-mates' homes (#515). */
export const trickOrTreatRoutes =
  (service: TrickOrTreatService, options: TrickOrTreatRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'trick-or-treat', TRICK_OR_TREAT_RATE_LIMITS);

    app.get(
      '/maps/:mapId/trick-or-treat',
      {
        schema: { params: MapIdParamsSchema, response: { 200: TrickOrTreatResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => ({
        trickOrTreat: await service.view(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/trick-or-treat',
      {
        schema: {
          params: MapIdParamsSchema,
          body: TrickOrTreatRequestSchema,
          response: { 200: TrickOrTreatVisitResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('visit'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.visit(requireUser(request), request.params.mapId, request.body),
    );

    done();
  };
