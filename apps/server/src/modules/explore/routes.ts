import {
  ExploreQuerySchema,
  ExploreTileResponseSchema,
  MapIdParamsSchema,
  SearchSpotRequestSchema,
  SearchSpotResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { EXPLORE_RATE_LIMITS } from './limits.js';
import type { ExploreService } from './service.js';

export interface ExploreRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Exploring your land (#199): the explore view of one of my tiles, and searching a spot. */
export const exploreRoutes =
  (service: ExploreService, options: ExploreRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'explore', EXPLORE_RATE_LIMITS);

    app.get(
      '/maps/:mapId/explore',
      {
        schema: {
          params: MapIdParamsSchema,
          querystring: ExploreQuerySchema,
          response: { 200: ExploreTileResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('explore')],
      },
      async (request) => service.view(requireUser(request), request.params.mapId, request.query),
    );

    app.post(
      '/maps/:mapId/explore/search',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SearchSpotRequestSchema,
          response: { 200: SearchSpotResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('explore'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.search(requireUser(request), request.params.mapId, request.body),
    );

    done();
  };
