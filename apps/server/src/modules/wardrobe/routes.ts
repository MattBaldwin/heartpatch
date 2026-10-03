import {
  DevGrantClothingRequestSchema,
  OutfitPresetParamsSchema,
  SavePresetRequestSchema,
  SetAccessoryRequestSchema,
  SetAccessoryResponseSchema,
  SquishyParamsSchema,
  WardrobeResponseSchema,
  WearRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { WARDROBE_RATE_LIMITS, type WardrobeAction } from './limits.js';
import type { WardrobeService } from './service.js';

export interface WardrobeRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also registers `POST /dev/wardrobe/items`, which
   * hands the player clothing. Never in production (`config.ts` refuses it there).
   */
  devGrants: boolean;
}

export const wardrobeRoutes =
  (service: WardrobeService, options: WardrobeRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const rateLimit = playerRateLimit(fastify, 'wardrobe', WARDROBE_RATE_LIMITS);
    const command = (action: WardrobeAction) => ({
      preHandler: [requireAuth, rateLimit(action), idempotency.preHandler],
      onSend: idempotency.onSend,
    });

    app.get(
      '/wardrobe',
      { schema: { response: { 200: WardrobeResponseSchema } }, preHandler: requireAuth },
      async (request) => ({ wardrobe: await service.get(requireUser(request)) }),
    );

    app.post(
      '/wardrobe/wear',
      {
        schema: { body: WearRequestSchema, response: { 200: WardrobeResponseSchema } },
        ...command('wear'),
      },
      async (request) => ({
        wardrobe: await service.wear(requireUser(request), request.body.wearing),
      }),
    );

    app.post(
      '/wardrobe/presets/:preset',
      {
        schema: {
          params: OutfitPresetParamsSchema,
          body: SavePresetRequestSchema,
          response: { 200: WardrobeResponseSchema },
        },
        ...command('wear'),
      },
      async (request) => ({
        wardrobe: await service.savePreset(
          requireUser(request),
          request.params.preset,
          request.body,
        ),
      }),
    );

    app.post(
      '/wardrobe/presets/:preset/wear',
      {
        schema: { params: OutfitPresetParamsSchema, response: { 200: WardrobeResponseSchema } },
        ...command('wear'),
      },
      async (request) => ({
        wardrobe: await service.wearPreset(requireUser(request), request.params.preset),
      }),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/accessory',
      {
        schema: {
          params: SquishyParamsSchema,
          body: SetAccessoryRequestSchema,
          response: { 200: SetAccessoryResponseSchema },
        },
        ...command('wear'),
      },
      async (request) =>
        service.setAccessory(
          requireUser(request),
          request.params.mapId,
          request.params.squishyId,
          request.body.itemId,
        ),
    );

    if (options.devGrants) {
      app.post(
        '/dev/wardrobe/items',
        {
          schema: {
            body: DevGrantClothingRequestSchema,
            response: { 201: WardrobeResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) => {
          const wardrobe = await service.devGrant(requireUser(request), request.body.items);
          return reply.code(201).send({ wardrobe });
        },
      );
    }

    done();
  };
