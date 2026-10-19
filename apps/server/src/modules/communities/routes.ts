import {
  CommunityNameRequestSchema,
  CommunityParamsSchema,
  CommunityTileQuerySchema,
  CommunityViewSchema,
  MapIdParamsSchema,
  RestorePieceRequestSchema,
  RestoreTileResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { COMMUNITY_RATE_LIMITS } from './limits.js';
import type { RestoreService } from './restore.js';

export interface CommunityRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** `HP_DEV_SQUISHY_GRANTS`: also the dev route that brings a village to its last pieces. Never in production. */
  devTools?: boolean;
}

/** Restoring and naming grey villages (#306 PR 3). The villages themselves come with the map view. */
export const communityRoutes =
  (service: RestoreService, options: CommunityRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'communities', COMMUNITY_RATE_LIMITS);

    // The restore sheet for one village tile.
    app.get(
      '/maps/:mapId/communities/:communityId/restore',
      {
        schema: {
          params: CommunityParamsSchema,
          querystring: CommunityTileQuerySchema,
          response: { 200: RestoreTileResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('communities')],
      },
      async (request) =>
        service.view(
          requireUser(request),
          request.params.mapId,
          request.params.communityId,
          request.query,
        ),
    );

    // Put one piece back (one transaction; a retried tap pays once).
    app.post(
      '/maps/:mapId/communities/:communityId/restore',
      {
        schema: {
          params: CommunityParamsSchema,
          body: RestorePieceRequestSchema,
          response: { 200: RestoreTileResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('communities'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.restore(
          requireUser(request),
          request.params.mapId,
          request.params.communityId,
          request.body,
        ),
    );

    // Name a won village (its winner, through the text filter).
    app.post(
      '/maps/:mapId/communities/:communityId/name',
      {
        schema: {
          params: CommunityParamsSchema,
          body: CommunityNameRequestSchema,
          response: { 200: CommunityViewSchema },
        },
        preHandler: [requireAuth, rateLimit('communities'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.name(
          requireUser(request),
          request.params.mapId,
          request.params.communityId,
          request.body,
        ),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/village-almost',
        {
          schema: { params: MapIdParamsSchema, response: { 201: CommunityViewSchema } },
          preHandler: [requireAuth, rateLimit('communities')],
        },
        async (request, reply) =>
          reply.code(201).send(await service.devAlmost(requireUser(request), request.params.mapId)),
      );
    }

    done();
  };
