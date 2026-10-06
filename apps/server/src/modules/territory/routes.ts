import {
  AttackTileRequestSchema,
  BattleResponseSchema,
  LandTendingResponseSchema,
  MapIdParamsSchema,
  SetDefendersRequestSchema,
  TerritoryResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { TERRITORY_RATE_LIMITS } from './limits.js';
import type { TerritoryService } from './service.js';

export interface TerritoryRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const territoryRoutes =
  (service: TerritoryService, options: TerritoryRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const rateLimit = playerRateLimit(fastify, 'territory', TERRITORY_RATE_LIMITS);

    app.get(
      '/maps/:mapId/territory',
      {
        schema: { params: MapIdParamsSchema, response: { 200: TerritoryResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        territory: await service.status(requireUser(request), request.params.mapId),
      }),
    );

    // Land that misses you (owner decision 2026-10-06): only the owner sees theirs.
    app.get(
      '/maps/:mapId/territory/tending',
      {
        schema: { params: MapIdParamsSchema, response: { 200: LandTendingResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        tending: await service.tending(requireUser(request), request.params.mapId),
      }),
    );

    // Visit tends all my land; a repeat just tends it again, so no Idempotency-Key.
    app.post(
      '/maps/:mapId/territory/visit',
      {
        schema: { params: MapIdParamsSchema, response: { 200: LandTendingResponseSchema } },
        preHandler: [requireAuth, rateLimit('visit')],
      },
      async (request) => ({
        tending: await service.visit(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/attacks',
      {
        schema: {
          params: MapIdParamsSchema,
          body: AttackTileRequestSchema,
          response: { 200: BattleResponseSchema, 201: BattleResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('attack'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.attack(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(result.created ? 201 : 200).send({ battle: result.battle });
      },
    );

    app.post(
      '/maps/:mapId/defenders',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetDefendersRequestSchema,
          response: { 200: TerritoryResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('defenders'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        territory: await service.setDefenders(
          requireUser(request),
          request.params.mapId,
          request.body,
        ),
      }),
    );

    done();
  };
