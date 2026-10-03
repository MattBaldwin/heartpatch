import {
  CareListResponseSchema,
  CareRequestSchema,
  CareResponseSchema,
  MapIdParamsSchema,
  RenameSquishyRequestSchema,
  SquishyParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { CARE_RATE_LIMITS } from './limits.js';
import type { CareService } from './service.js';

export interface CareRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const careRoutes =
  (service: CareService, options: CareRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const rateLimit = playerRateLimit(fastify, 'care', CARE_RATE_LIMITS);
    const commandHooks = {
      preHandler: [requireAuth, rateLimit('care'), idempotency.preHandler],
      onSend: idempotency.onSend,
    };

    app.get(
      '/maps/:mapId/care',
      {
        schema: { params: MapIdParamsSchema, response: { 200: CareListResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.list(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/care',
      {
        schema: {
          params: SquishyParamsSchema,
          body: CareRequestSchema,
          response: { 200: CareResponseSchema },
        },
        ...commandHooks,
      },
      async (request) =>
        service.care(
          requireUser(request),
          request.params.mapId,
          request.params.squishyId,
          request.body.action,
        ),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/rename',
      {
        schema: {
          params: SquishyParamsSchema,
          body: RenameSquishyRequestSchema,
          response: { 200: CareListResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('rename'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.rename(
          requireUser(request),
          request.params.mapId,
          request.params.squishyId,
          request.body.nickname,
        ),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/care/seen',
      {
        schema: { params: SquishyParamsSchema, response: { 200: CareListResponseSchema } },
        ...commandHooks,
      },
      async (request) =>
        service.seen(requireUser(request), request.params.mapId, request.params.squishyId),
    );

    done();
  };
