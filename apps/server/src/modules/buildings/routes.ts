import {
  BuildingParamsSchema,
  DevUpkeepDueRequestSchema,
  FuelAllResponseSchema,
  FuelBuildingRequestSchema,
  HomeNameRequestSchema,
  HomeResponseSchema,
  HouseSquishyRequestSchema,
  MapIdParamsSchema,
  MoveBuildingRequestSchema,
  PlaceBuildingRequestSchema,
  RemoveBuildingResponseSchema,
  SquishyParamsSchema,
  UpkeepOrderRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { BUILDINGS_RATE_LIMITS } from './limits.js';
import type { BuildingsService } from './service.js';

export interface BuildingsRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also registers the resource-building dev routes
   * (#601), `POST /maps/:mapId/dev/buildings/ready` and
   * `POST /maps/:mapId/dev/upkeep/due`. Never in production (`config.ts`
   * refuses it there).
   */
  devTools?: boolean;
}

export const buildingsRoutes =
  (service: BuildingsService, options: BuildingsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const rateLimit = playerRateLimit(fastify, 'buildings', BUILDINGS_RATE_LIMITS);
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
      '/maps/:mapId/buildings/fuel-all',
      {
        schema: { params: MapIdParamsSchema, response: { 200: FuelAllResponseSchema } },
        ...commandHooks,
      },
      async (request) => service.fuelAll(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/buildings/:buildingId/upgrade',
      {
        schema: { params: BuildingParamsSchema, response: { 200: HomeResponseSchema } },
        ...commandHooks,
      },
      async (request) =>
        service.upgrade(requireUser(request), request.params.mapId, request.params.buildingId),
    );

    // Naming my home (#306 PR 0).
    app.post(
      '/maps/:mapId/home/name',
      {
        schema: {
          params: MapIdParamsSchema,
          body: HomeNameRequestSchema,
          response: { 200: HomeResponseSchema },
        },
        ...commandHooks,
      },
      async (request) => service.name(requireUser(request), request.params.mapId, request.body),
    );

    // The order my upkeep buildings pay in when Heart Coins run short (#601 Q5).
    app.post(
      '/maps/:mapId/buildings/upkeep-order',
      {
        schema: {
          params: MapIdParamsSchema,
          body: UpkeepOrderRequestSchema,
          response: { 200: HomeResponseSchema },
        },
        ...commandHooks,
      },
      async (request) =>
        service.upkeepOrder(requireUser(request), request.params.mapId, request.body),
    );

    if (options.devTools) {
      const devHooks = { preHandler: [requireAuth, rateLimit('build')] };
      app.post(
        '/maps/:mapId/dev/buildings/ready',
        {
          schema: { params: MapIdParamsSchema, response: { 200: HomeResponseSchema } },
          ...devHooks,
        },
        async (request) => service.devReady(requireUser(request), request.params.mapId),
      );
      app.post(
        '/maps/:mapId/dev/upkeep/due',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevUpkeepDueRequestSchema,
            response: { 200: HomeResponseSchema },
          },
          ...devHooks,
        },
        async (request) =>
          service.devUpkeepDue(requireUser(request), request.params.mapId, request.body.mornings),
      );
    }

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
