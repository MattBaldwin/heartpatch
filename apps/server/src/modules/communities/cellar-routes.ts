import {
  CellarSearchRequestSchema,
  CellarViewSchema,
  CommunityParamsSchema,
  CommunityViewSchema,
  HexSchema,
  MapIdParamsSchema,
  SearchSpotResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser } from '../auth/hooks.js';
import type { CellarService } from './cellar.js';
import { COMMUNITY_RATE_LIMITS } from './limits.js';
import type { CommunityRoutesOptions } from './routes.js';

/** The key hunt and the hidden cellar (#306 PR 2c). The hunt's state comes with the map view. */
export const cellarRoutes =
  (service: CellarService, options: CommunityRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'communities', COMMUNITY_RATE_LIMITS);

    // Dig the cellar key up on the tile the village's map points to.
    app.post(
      '/maps/:mapId/communities/:communityId/key',
      {
        schema: { params: CommunityParamsSchema, response: { 200: CommunityViewSchema } },
        preHandler: [requireAuth, rateLimit('communities'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.digKey(requireUser(request), request.params.mapId, request.params.communityId),
    );

    // Open the cellar under the square with the key.
    app.post(
      '/maps/:mapId/communities/:communityId/cellar',
      {
        schema: { params: CommunityParamsSchema, response: { 200: CommunityViewSchema } },
        preHandler: [requireAuth, rateLimit('communities'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.open(requireUser(request), request.params.mapId, request.params.communityId),
    );

    // The open cellar up close.
    app.get(
      '/maps/:mapId/communities/:communityId/cellar',
      {
        schema: { params: CommunityParamsSchema, response: { 200: CellarViewSchema } },
        preHandler: [requireAuth, rateLimit('communities')],
      },
      async (request) =>
        service.view(requireUser(request), request.params.mapId, request.params.communityId),
    );

    // Search one cellar spot (one transaction; send an Idempotency-Key).
    app.post(
      '/maps/:mapId/communities/:communityId/cellar/search',
      {
        schema: {
          params: CommunityParamsSchema,
          body: CellarSearchRequestSchema,
          response: { 200: SearchSpotResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('communities'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.search(
          requireUser(request),
          request.params.mapId,
          request.params.communityId,
          request.body,
        ),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/key-reach',
        {
          schema: {
            params: MapIdParamsSchema,
            body: z.object({ communityId: z.uuid() }),
            response: { 201: HexSchema },
          },
          preHandler: [requireAuth, rateLimit('communities')],
        },
        async (request, reply) =>
          reply
            .code(201)
            .send(
              await service.devKeyReach(
                requireUser(request),
                request.params.mapId,
                request.body.communityId,
              ),
            ),
      );
    }

    done();
  };
