import {
  MapIdParamsSchema,
  ResearchResponseSchema,
  ResearchViewSchema,
  StartResearchRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { RESEARCH_RATE_LIMITS } from './limits.js';
import type { ResearchService } from './service.js';

export interface ResearchRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** My Research Bench on a Clockwork Isle (#874). Other patches answer `NOT_FOUND`. */
export const researchRoutes =
  (service: ResearchService, options: ResearchRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'research', RESEARCH_RATE_LIMITS);
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('research'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/research',
      {
        schema: { params: MapIdParamsSchema, response: { 200: ResearchViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/research',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartResearchRequestSchema,
          response: { 201: ResearchResponseSchema },
        },
        ...commandHooks,
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
      '/maps/:mapId/research/claim',
      {
        schema: { params: MapIdParamsSchema, response: { 200: ResearchResponseSchema } },
        ...commandHooks,
      },
      async (request) => service.claim(requireUser(request), request.params.mapId),
    );

    done();
  };
