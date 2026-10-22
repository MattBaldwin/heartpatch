import {
  DevHomesteadRequestSchema,
  ExploreQuerySchema,
  ExploreTileResponseSchema,
  HexSchema,
  MapIdParamsSchema,
  SearchSpotRequestSchema,
  SearchSpotResponseSchema,
  DevRelightAnswerResponseSchema,
  DevStoryAnswerResponseSchema,
  DevStoryPagesRequestSchema,
  DevStoryPagesResponseSchema,
  SolvePuzzleRequestSchema,
  SolvePuzzleResponseSchema,
  StartPuzzleRequestSchema,
  StartPuzzleResponseSchema,
  TellStoryRequestSchema,
  TellStoryResponseSchema,
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
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also register the dev route that makes me a
   * ready homestead next to home (e2e and phone testing). Never in production.
   */
  devTools?: boolean;
}

/** Exploring your land (#199): the explore view of one of my tiles, searching a spot, and a grey village's puzzles (#306: Relight the path, The forgotten story). */
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

    // A grey village tile's Relight puzzle (#306 PR 2b): a try, then its moves.
    app.post(
      '/maps/:mapId/explore/puzzle/start',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartPuzzleRequestSchema,
          response: { 200: StartPuzzleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('explore')],
      },
      async (request) =>
        service.startPuzzle(requireUser(request), request.params.mapId, request.body),
    );
    app.post(
      '/maps/:mapId/explore/puzzle',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SolvePuzzleRequestSchema,
          response: { 200: SolvePuzzleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('explore'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.solvePuzzle(requireUser(request), request.params.mapId, request.body),
    );
    // The heart tile's forgotten story (#306): tell it, first to last.
    app.post(
      '/maps/:mapId/explore/puzzle/story',
      {
        schema: {
          params: MapIdParamsSchema,
          body: TellStoryRequestSchema,
          response: { 200: TellStoryResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('explore'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.tellStory(requireUser(request), request.params.mapId, request.body),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/homestead',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevHomesteadRequestSchema.nullish(),
            response: { 201: HexSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) =>
          reply
            .code(201)
            .send(
              await service.devHomestead(
                requireUser(request),
                request.params.mapId,
                request.body ?? {},
              ),
            ),
      );
      // My latest Relight try's answer (#306 PR 2b), for e2e and captures only.
      app.post(
        '/maps/:mapId/dev/relight-answer',
        {
          schema: {
            params: MapIdParamsSchema,
            body: StartPuzzleRequestSchema,
            response: { 200: DevRelightAnswerResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) =>
          service.devRelightAnswer(requireUser(request), request.params.mapId, request.body),
      );
      // The forgotten story (#306), for e2e and captures only: my latest try's
      // order, and the Hollow's torn pages found.
      app.post(
        '/maps/:mapId/dev/story-answer',
        {
          schema: {
            params: MapIdParamsSchema,
            body: StartPuzzleRequestSchema,
            response: { 200: DevStoryAnswerResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) =>
          service.devStoryAnswer(requireUser(request), request.params.mapId, request.body),
      );
      app.post(
        '/maps/:mapId/dev/story-pages',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevStoryPagesRequestSchema,
            response: { 200: DevStoryPagesResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) =>
          service.devStoryPages(requireUser(request), request.params.mapId, request.body),
      );
      app.post(
        '/maps/:mapId/dev/hollowed-reach',
        {
          // Replies with that village's square.
          schema: { params: MapIdParamsSchema, response: { 201: HexSchema } },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) =>
          reply
            .code(201)
            .send(await service.devHollowedReach(requireUser(request), request.params.mapId)),
      );
    }

    done();
  };
