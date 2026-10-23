import {
  CrookedChestRequestSchema,
  CrookedChestResponseSchema,
  CrookedEnterRequestSchema,
  CrookedEnterResponseSchema,
  CrookedFixRequestSchema,
  CrookedFixResponseSchema,
  CrookedPowerRequestSchema,
  CrookedUnlockRequestSchema,
  CrookedViewResponseSchema,
  DevFarHollowRequestSchema,
  FarHollowViewSchema,
  MapIdParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { FAR_HOLLOW_RATE_LIMITS } from './limits.js';
import type { FarHollowService } from './service.js';

export interface FarHollowRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** `HP_DEV_SQUISHY_GRANTS`: also the dev route that arrives without the far road. Never in production. */
  devTools?: boolean;
}

/**
 * The far Hollow (#306 PR 6): my own this season, and the Crooked House's
 * commands (#306 6b), each one transaction (send an Idempotency-Key). The
 * far road itself is a journey (modules/journeys).
 */
export const farHollowRoutes =
  (service: FarHollowService, options: FarHollowRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'far-hollow', FAR_HOLLOW_RATE_LIMITS);
    const idempotency = options.idempotency(fastify);
    const command = {
      preHandler: [requireAuth, rateLimit('farHollow'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/far-hollow',
      {
        schema: { params: MapIdParamsSchema, response: { 200: FarHollowViewSchema } },
        preHandler: [requireAuth, rateLimit('farHollow')],
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/far-hollow/fix',
      {
        schema: {
          params: MapIdParamsSchema,
          body: CrookedFixRequestSchema,
          response: { 200: CrookedFixResponseSchema },
        },
        ...command,
      },
      async (request) => service.fix(requireUser(request), request.params.mapId, request.body),
    );

    app.post(
      '/maps/:mapId/far-hollow/enter',
      {
        schema: {
          params: MapIdParamsSchema,
          body: CrookedEnterRequestSchema,
          response: { 200: CrookedEnterResponseSchema },
        },
        ...command,
      },
      async (request) => service.enter(requireUser(request), request.params.mapId, request.body),
    );

    app.post(
      '/maps/:mapId/far-hollow/unlock',
      {
        schema: {
          params: MapIdParamsSchema,
          body: CrookedUnlockRequestSchema,
          response: { 200: CrookedViewResponseSchema },
        },
        ...command,
      },
      async (request) => service.unlock(requireUser(request), request.params.mapId, request.body),
    );

    app.post(
      '/maps/:mapId/far-hollow/power',
      {
        schema: {
          params: MapIdParamsSchema,
          body: CrookedPowerRequestSchema,
          response: { 200: CrookedViewResponseSchema },
        },
        ...command,
      },
      async (request) => service.power(requireUser(request), request.params.mapId, request.body),
    );

    app.post(
      '/maps/:mapId/far-hollow/chest',
      {
        schema: {
          params: MapIdParamsSchema,
          body: CrookedChestRequestSchema,
          response: { 200: CrookedChestResponseSchema },
        },
        ...command,
      },
      async (request) => service.chest(requireUser(request), request.params.mapId, request.body),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/far-hollow',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevFarHollowRequestSchema.optional(),
            response: { 201: FarHollowViewSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request, reply) =>
          reply
            .code(201)
            .send(
              await service.devArrive(requireUser(request), request.params.mapId, request.body),
            ),
      );
    }

    done();
  };
