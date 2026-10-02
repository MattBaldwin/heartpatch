import { AcknowledgeStepRequestSchema, TutorialResponseSchema } from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { TUTORIAL_RATE_LIMITS, type TutorialAction } from './limits.js';
import type { TutorialService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface TutorialRoutesOptions {
  hooks: AuthHooks;
}

export const tutorialRoutes =
  (service: TutorialService, options: TutorialRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: TutorialAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = TUTORIAL_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `tutorial:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `tutorial:${action}:user:${requireUser(request).id}`),
      ];
      return async (request, reply) => {
        for (const check of checks) {
          const result = await check(request);
          if (!result.isAllowed && result.isExceeded) {
            void reply.header('retry-after', result.ttlInSeconds);
            throw new AppError('RATE_LIMITED', RATE_LIMITED_MESSAGE);
          }
        }
      };
    };

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
      { schema: { response: { 200: TutorialResponseSchema } }, preHandler: requireAuth },
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
