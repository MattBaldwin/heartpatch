import { HouseViewSchema, MapIdParamsSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { HouseService } from './service.js';

export interface HouseRoutesOptions {
  hooks: AuthHooks;
}

/**
 * The Keeper's house (#381): `GET /maps/:mapId/house` (my house and what the
 * next level needs). NOT_FOUND while `HP_HOUSE` is off for the player.
 * Building, residents and the rest arrive with their own PRs.
 */
export const houseRoutes =
  (service: HouseService, options: HouseRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    app.get(
      '/maps/:mapId/house',
      {
        schema: { params: MapIdParamsSchema, response: { 200: HouseViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.get(requireUser(request), request.params.mapId),
    );

    done();
  };
