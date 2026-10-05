import {
  CollectWorkResponseSchema,
  JobsViewSchema,
  MapIdParamsSchema,
  SetJobRequestSchema,
  SetTeamRequestSchema,
  SquishyParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { JOBS_RATE_LIMITS } from './limits.js';
import type { SquishyJobsService } from './service.js';

export interface SquishyJobsRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /** Registers the dev-only short timer (`HP_DEV_SQUISHY_GRANTS`; never in production). */
  devTools?: boolean;
}

/** Squishy jobs: the job board, one squishy's job, the team, and collecting work. */
export const squishyJobsRoutes =
  (service: SquishyJobsService, options: SquishyJobsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'jobs', JOBS_RATE_LIMITS);

    app.get(
      '/maps/:mapId/jobs',
      {
        schema: { params: MapIdParamsSchema, response: { 200: JobsViewSchema } },
        preHandler: requireAuth,
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/squishies/:squishyId/job',
      {
        schema: {
          params: SquishyParamsSchema,
          body: SetJobRequestSchema,
          response: { 200: JobsViewSchema },
        },
        preHandler: [requireAuth, rateLimit('jobs'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) =>
        service.setJob(
          requireUser(request),
          request.params.mapId,
          request.params.squishyId,
          request.body,
        ),
    );

    app.post(
      '/maps/:mapId/team',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetTeamRequestSchema,
          response: { 200: JobsViewSchema },
        },
        preHandler: [requireAuth, rateLimit('jobs'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.setTeam(requireUser(request), request.params.mapId, request.body),
    );

    app.post(
      '/maps/:mapId/work/collect',
      {
        schema: { params: MapIdParamsSchema, response: { 200: CollectWorkResponseSchema } },
        preHandler: [requireAuth, rateLimit('jobs'), idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => service.collect(requireUser(request), request.params.mapId),
    );

    if (options.devTools) {
      // Dev and test only: every gatherer finishes one more cycle now (e2e's short timer).
      app.post(
        '/maps/:mapId/dev/work/ready',
        {
          schema: { params: MapIdParamsSchema, response: { 200: JobsViewSchema } },
          preHandler: [requireAuth, rateLimit('jobs')],
        },
        async (request) => service.devReady(requireUser(request), request.params.mapId),
      );
    }

    done();
  };
