import { CinematicResponseSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { CINEMATIC_RATE_LIMITS } from './limits.js';
import type { CinematicService } from './service.js';

export interface CinematicRoutesOptions {
  hooks: AuthHooks;
}

export const cinematicRoutes =
  (service: CinematicService, options: CinematicRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    const rateLimit = playerRateLimit(fastify, 'cinematic', CINEMATIC_RATE_LIMITS);

    app.get(
      '/cinematic',
      { schema: { response: { 200: CinematicResponseSchema } }, preHandler: requireAuth },
      async (request) => ({ cinematic: await service.get(requireUser(request)) }),
    );

    app.post(
      '/cinematic/seen',
      {
        schema: { response: { 200: CinematicResponseSchema } },
        preHandler: [requireAuth, rateLimit('seen')],
      },
      async (request) => ({ cinematic: await service.markSeen(requireUser(request)) }),
    );

    done();
  };
