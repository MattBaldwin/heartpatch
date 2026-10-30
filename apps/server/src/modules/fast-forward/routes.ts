import { MapIdParamsSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { FAST_FORWARD_RATE_LIMITS } from './limits.js';
import type { FastForwardService } from './service.js';

// Dev only, so the schemas stay here: no client code calls this route.
const DevFastForwardRequestSchema = z.strictObject({
  day: z.union([z.literal(3), z.literal(10), z.literal(21)]),
});
const DevFastForwardResponseSchema = z.object({
  day: z.number().int(),
  partnerLevel: z.number().int(),
  tiles: z.number().int(),
  added: z.number().int(),
});

export interface FastForwardRoutesOptions {
  hooks: AuthHooks;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: registers `POST /maps/:mapId/dev/fast-forward`,
   * which seeds my account on a patch as the casual kid stands on day 3, 10
   * or 21 (#736, PLAYTEST.md "Day-N cold play"). Never in production
   * (`config.ts` refuses it there).
   */
  devGrants: boolean;
}

/** The day-N playtest seed (#736 part B). Registers nothing outside dev. */
export const fastForwardRoutes =
  (service: FastForwardService, options: FastForwardRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'fast-forward', FAST_FORWARD_RATE_LIMITS);

    if (options.devGrants) {
      app.post(
        '/maps/:mapId/dev/fast-forward',
        {
          schema: {
            params: MapIdParamsSchema,
            body: DevFastForwardRequestSchema,
            response: { 200: DevFastForwardResponseSchema },
          },
          preHandler: [requireAuth, rateLimit('dev')],
        },
        async (request) =>
          service.devFastForward(requireUser(request), request.params.mapId, request.body.day),
      );
    }

    done();
  };
