import {
  CollectResponseSchema,
  CraftParamsSchema,
  CraftResponseSchema,
  DevGrantItemsRequestSchema,
  InventoryResponseSchema,
  ItemsResponseSchema,
  MapIdParamsSchema,
  StartCraftRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { INVENTORY_RATE_LIMITS, type InventoryAction } from './limits.js';
import type { InventoryService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

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

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: InventoryAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = INVENTORY_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `inventory:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `inventory:${action}:user:${requireUser(request).id}`),
      ];
      return async (request, reply) => {
        for (const check of checks) {
          const result = await check(request);
          if (!result.isAllowed && result.isExceeded) {
            void reply.header('retry-after', result.ttlInSeconds);
            throw new AppError('RATE_LIMITED', RATE_LIMITED_MESSAGE);
          }
        }
      };
    };

    app.get(
      '/maps/:mapId/inventory',
      {
        schema: { params: MapIdParamsSchema, response: { 200: InventoryResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.get(requireUser(request), request.params.mapId),
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
