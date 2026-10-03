import { AcknowledgeStepRequestSchema, TutorialResponseSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { TUTORIAL_RATE_LIMITS } from './limits.js';
import type { TutorialService } from './service.js';

export interface TutorialRoutesOptions {
  hooks: AuthHooks;
}

export const tutorialRoutes =
  (service: TutorialService, options: TutorialRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    const rateLimit = playerRateLimit(fastify, 'tutorial', TUTORIAL_RATE_LIMITS);

    app.get(
      '/tutorial',
      { schema: { response: { 200: TutorialResponseSchema } }, preHandler: requireAuth },
      async (request) => ({ tutorial: await service.state(requireUser(request)) }),
    );

    app.post(
      '/tutorial/start',
      {
        schema: { response: { 200: TutorialResponseSchema, 201: TutorialResponseSchema } },
        preHandler: [requireAuth, rateLimit('newRun')],
      },
      async (request, reply) => {
        const result = await service.start(requireUser(request));
        return reply.code(result.created ? 201 : 200).send({ tutorial: result.tutorial });
      },
    );

    app.post(
      '/tutorial/replay',
      {
        schema: { response: { 201: TutorialResponseSchema } },
        preHandler: [requireAuth, rateLimit('newRun')],
      },
      async (request, reply) => {
        const tutorial = await service.replay(requireUser(request));
        return reply.code(201).send({ tutorial });
      },
    );

    app.post(
      '/tutorial/skip',
      {
        schema: { response: { 200: TutorialResponseSchema } },
        preHandler: [requireAuth, rateLimit('newRun')],
      },
      async (request) => ({ tutorial: await service.skip(requireUser(request)) }),
    );

    app.post(
      '/tutorial/acknowledge',
      {
        schema: { body: AcknowledgeStepRequestSchema, response: { 204: z.null() } },
        preHandler: [requireAuth, rateLimit('acknowledge')],
      },
      async (request, reply) => {
        await service.acknowledge(requireUser(request), request.body.stepId);
        return reply.code(204).send(null);
      },
    );

    done();
  };
