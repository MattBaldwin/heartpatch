import {
  CatalogResponseSchema,
  MapIdParamsSchema,
  WildHintsResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { SpawnsService } from './service.js';

export interface SpawnsRoutesOptions {
  hooks: AuthHooks;
}

/** Wild squishy hints and the catalog. Battles start through `POST /maps/:mapId/battles`. */
export const spawnsRoutes =
  (service: SpawnsService, options: SpawnsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    app.get(
      '/maps/:mapId/wild',
      {
        schema: { params: MapIdParamsSchema, response: { 200: WildHintsResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        wild: await service.wildHints(requireUser(request), request.params.mapId),
      }),
    );

    app.get(
      '/maps/:mapId/catalog',
      {
        schema: { params: MapIdParamsSchema, response: { 200: CatalogResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        catalog: await service.catalog(requireUser(request), request.params.mapId),
      }),
    );

    done();
  };
