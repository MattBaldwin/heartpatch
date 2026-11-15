import {
  ComputerMatesStateSchema,
  MapIdParamsSchema,
  SetComputerMatesRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { COMPUTER_MATES_RATE_LIMITS } from './limits.js';
import type { ComputerMatesService } from './service.js';

export interface ComputerMatesRoutesOptions {
  hooks: AuthHooks;
}

export const computerMatesRoutes =
  (service: ComputerMatesService, options: ComputerMatesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'computer-mates', COMPUTER_MATES_RATE_LIMITS);

    // The owner's computer patch-mates switch (#386). NOT_FOUND while
    // `HP_COMPUTER_MATES` is closed for this patch.
    app.post(
      '/maps/:mapId/computer-mates',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetComputerMatesRequestSchema,
          response: { 200: ComputerMatesStateSchema },
        },
        preHandler: [requireAuth, rateLimit('owner')],
      },
      async (request) =>
        service.setEnabled(requireUser(request), request.params.mapId, request.body.enabled),
    );

    done();
  };
