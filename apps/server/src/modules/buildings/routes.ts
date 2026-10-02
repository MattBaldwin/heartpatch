import {
  BuildingParamsSchema,
  FuelBuildingRequestSchema,
  HomeResponseSchema,
  HouseSquishyRequestSchema,
  MapIdParamsSchema,
  MoveBuildingRequestSchema,
  PlaceBuildingRequestSchema,
  RemoveBuildingResponseSchema,
  SquishyParamsSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { Idempotency } from '../../lib/idempotency.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { BUILDINGS_RATE_LIMITS, type BuildingsAction } from './limits.js';
import type { BuildingsService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface BuildingsRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const buildingsRoutes =
  (service: BuildingsService, options: BuildingsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: BuildingsAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = BUILDINGS_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `buildings:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `buildings:${action}:user:${requireUser(request).id}`),
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
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('build'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/home',
      {
        schema: { params: MapIdParamsSchema, response: { 200: HomeResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.home(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/buildings',
      {
        schema: {
          params: MapIdParamsSchema,
          body: PlaceBuildingRequestSchema,
          response: { 201: HomeResponseSchema },
        },
        ...commandHooks,
      },
      async (request, reply) => {
        const home = await service.place(requireUser(request), request.params.mapId, request.body);
        return reply.code(201).send(home);
      },
    );

    app.post(
      '/maps/:mapId/buildings/:buildingId/move',
      {
        schema: {
          params: BuildingParamsSchema,
          body: MoveBuildingRequestSchema,
          response: { 200: HomeResponseSchema },
        },
        ...commandHooks,
      },
      async (request) =>
        service.move(
          requireUser(request),
          request.params.mapId,
          request.params.buildingId,
          request.body,
        ),
    );

    app.post(
      '/maps/:mapId/buildings/:buildingId/remove',
      {
        schema: { params: BuildingParamsSchema, response: { 200: RemoveBuildingResponseSchema } },
        ...commandHooks,
      },
      async (request) =>
        service.remove(requireUser(request), request.params.mapId, request.params.buildingId),
    );

    app.post(
      '/maps/:mapId/buildings/:buildingId/fuel',
      {
        schema: {
          params: BuildingParamsSchema,
          body: FuelBuildingRequestSchema,
          response: { 200: HomeResponseSchema },
        },
        ...commandHooks,
      },
      async (request) =>
        service.fuel(
          requireUser(request),
          request.params.mapId,
          request.params.buildingId,
          request.body.nights,
        ),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/habitat',
      {
        schema: {
          params: SquishyParamsSchema,
          body: HouseSquishyRequestSchema,
          response: { 200: HomeResponseSchema },
        },
        ...commandHooks,
      },
      async (request) =>
        service.house(
          requireUser(request),
          request.params.mapId,
          request.params.squishyId,
          request.body.habitatId,
        ),
    );

    done();
  };
