import { HealthResponseSchema, ReadyResponseSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from '../../lib/zod.js';
import type { HealthService } from './service.js';

export const healthRoutes =
  (service: HealthService): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.get('/health', { schema: { response: { 200: HealthResponseSchema } } }, () =>
      service.health(),
    );

    app.get(
      '/ready',
      { schema: { response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema } } },
      async (_request, reply) => {
        const result = await service.ready();
        return reply.status(result.status === 'ready' ? 200 : 503).send(result);
      },
    );

    done();
  };
