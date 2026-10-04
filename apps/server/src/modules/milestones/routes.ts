import {
  EquipTitleRequestSchema,
  MilestonesResponseSchema,
  MilestonesSeenRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { MILESTONES_RATE_LIMITS } from './limits.js';
import type { MilestonesService } from './service.js';

export interface MilestonesRoutesOptions {
  hooks: AuthHooks;
}

/**
 * Keeper milestones (design doc §24), account-level: `GET /milestones` (my
 * tracks, titles and anything new to celebrate), `POST /milestones/seen`
 * (celebrated) and `POST /milestones/title` (wear an earned title, or none).
 * Both posts are idempotent by nature, so they need no `Idempotency-Key`.
 */
export const milestonesRoutes =
  (service: MilestonesService, options: MilestonesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'milestones', MILESTONES_RATE_LIMITS);

    app.get(
      '/milestones',
      { schema: { response: { 200: MilestonesResponseSchema } }, preHandler: requireAuth },
      async (request) => service.get(requireUser(request)),
    );

    app.post(
      '/milestones/seen',
      {
        schema: { body: MilestonesSeenRequestSchema, response: { 200: MilestonesResponseSchema } },
        preHandler: [requireAuth, rateLimit('update')],
      },
      async (request) => service.seen(requireUser(request), request.body.ids),
    );

    app.post(
      '/milestones/title',
      {
        schema: { body: EquipTitleRequestSchema, response: { 200: MilestonesResponseSchema } },
        preHandler: [requireAuth, rateLimit('update')],
      },
      async (request) => service.equipTitle(requireUser(request), request.body.titleId),
    );

    done();
  };
