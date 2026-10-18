import { PERF_REPORT_MAX_BYTES, PerfReportSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { PERF_RATE_LIMITS } from './limits.js';
import type { PerfService } from './service.js';

export interface PerfRoutesOptions {
  hooks: AuthHooks;
}

export const perfRoutes =
  (service: PerfService, options: PerfRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    const rateLimit = playerRateLimit(fastify, 'perf', PERF_RATE_LIMITS);

    app.post(
      '/perf/report',
      {
        // A bigger body is refused (413) before it's parsed.
        bodyLimit: PERF_REPORT_MAX_BYTES,
        schema: { body: PerfReportSchema, response: { 204: z.null() } },
        preHandler: [requireAuth, rateLimit('report')],
      },
      async (request, reply) => {
        service.record(requireUser(request), request.body, request.log);
        return reply.code(204).send(null);
      },
    );

    done();
  };
