import { BuildHouseRequestSchema, HouseViewSchema, MapIdParamsSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { HOUSE_RATE_LIMITS } from './limits.js';
import type { HouseService } from './service.js';

export interface HouseRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/**
 * The Keeper's house (#381): `GET /maps/:mapId/house` (my house and what the
 * next level needs) and `POST /maps/:mapId/house/build` (build the next
 * level; `Idempotency-Key`). NOT_FOUND while `HP_HOUSE` is off for the player.
 */
export const houseRoutes =
  (service: HouseService, options: HouseRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'house', HOUSE_RATE_LIMITS);

    app.get(
      '/maps/:mapId/house',
      {
        schema: { params: MapIdParamsSchema, response: { 200: HouseViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.get(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/house/build',
      {
        schema: {
          params: MapIdParamsSchema,
          body: BuildHouseRequestSchema,
          response: { 200: HouseViewSchema },
        },
        preHandler: [requireAuth, rateLimit('build'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.build(requireUser(request), request.params.mapId, request.body.toLevel),
    );

    done();
  };
