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
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { WARDROBE_RATE_LIMITS, type WardrobeAction } from './limits.js';
import type { WardrobeService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

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

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: WardrobeAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = WARDROBE_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `wardrobe:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `wardrobe:${action}:user:${requireUser(request).id}`),
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
