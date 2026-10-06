import {
  CollectResponseSchema,
  CraftParamsSchema,
  CraftResponseSchema,
  DevGrantItemsRequestSchema,
  InventoryResponseSchema,
  ItemsResponseSchema,
  MapIdParamsSchema,
  RecipeBookResponseSchema,
  StartCraftRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { INVENTORY_RATE_LIMITS } from './limits.js';
import type { InventoryService } from './service.js';

export interface InventoryRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also register the dev route that hands a player
   * items. Never in production (`config.ts` refuses it there).
   */
  devGrants: boolean;
}

export const inventoryRoutes =
  (service: InventoryService, options: InventoryRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const rateLimit = playerRateLimit(fastify, 'inventory', INVENTORY_RATE_LIMITS);

    app.get(
      '/maps/:mapId/inventory',
      {
        schema: { params: MapIdParamsSchema, response: { 200: InventoryResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.get(requireUser(request), request.params.mapId),
    );

    // The recipe book (owner decision 2026-10-05): account-level, like `/lore`.
    app.get(
      '/recipe-book',
      {
        schema: { response: { 200: RecipeBookResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.recipeBook(requireUser(request)),
    );

    app.post(
      '/maps/:mapId/crafts',
      {
        schema: {
          params: MapIdParamsSchema,
          body: StartCraftRequestSchema,
          response: { 201: CraftResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('craft'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request, reply) => {
        const result = await service.startCraft(
          requireUser(request),
          request.params.mapId,
          request.body.recipeId,
        );
        return reply.code(201).send(result);
      },
    );

    app.post(
      '/maps/:mapId/crafts/:craftId/collect',
      {
        schema: { params: CraftParamsSchema, response: { 200: CollectResponseSchema } },
        preHandler: [requireAuth, rateLimit('craft'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.collectCraft(requireUser(request), request.params.mapId, request.params.craftId),
    );

    if (options.devGrants) {
      // Dev and test only: the player's crafts finish now, so a phone or an
      // e2e run sees one land in the bag without the real wait.
      app.post(
        '/maps/:mapId/dev/crafts/ready',
        {
          schema: { params: MapIdParamsSchema, response: { 200: InventoryResponseSchema } },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) => service.devCraftsReady(requireUser(request), request.params.mapId),
      );
      app.post(
        '/maps/:mapId/dev/items',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevGrantItemsRequestSchema,
            response: { 201: ItemsResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) => {
          const items = await service.devGrant(
            requireUser(request),
            request.params.mapId,
            request.body.items,
          );
          return reply.code(201).send({ items });
        },
      );
    }

    done();
  };
