import {
  AccountHelpersResponseSchema,
  AskHelperRequestSchema,
  HelperCandidatesResponseSchema,
  HelperUserParamsSchema,
  MemberPasswordResetResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { HELPER_RATE_LIMITS } from './limits.js';
import type { AccountHelpersService } from './service.js';

export interface AccountHelpersRoutesOptions {
  hooks: AuthHooks;
}

/**
 * Grown-up helpers (#197). `/account/helpers/:userId` is one of your helpers;
 * `/account/helping/:userId` is a player who asked you. Nothing takes a
 * typed name, so no route can say whether a username exists.
 */
export const accountHelpersRoutes =
  (service: AccountHelpersService, options: AccountHelpersRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'helpers', HELPER_RATE_LIMITS);
    const change = [requireAuth, rateLimit('change')];
    const linkSchema = {
      params: HelperUserParamsSchema,
      response: { 200: AccountHelpersResponseSchema },
    };

    app.get(
      '/account/helpers',
      { schema: { response: { 200: AccountHelpersResponseSchema } }, preHandler: requireAuth },
      (request) => service.mine(requireUser(request)),
    );

    app.get(
      '/account/helpers/candidates',
      { schema: { response: { 200: HelperCandidatesResponseSchema } }, preHandler: requireAuth },
      (request) => service.candidates(requireUser(request)),
    );

    app.post(
      '/account/helpers',
      {
        schema: { body: AskHelperRequestSchema, response: { 200: AccountHelpersResponseSchema } },
        preHandler: change,
      },
      (request) => service.ask(requireUser(request), request.body.helperId),
    );

    app.post('/account/helpers/:userId/remove', { schema: linkSchema, preHandler: change }, (r) =>
      service.removeHelper(requireUser(r), r.params.userId),
    );

    app.post('/account/helping/:userId/accept', { schema: linkSchema, preHandler: change }, (r) =>
      service.accept(requireUser(r), r.params.userId),
    );

    app.post('/account/helping/:userId/decline', { schema: linkSchema, preHandler: change }, (r) =>
      service.decline(requireUser(r), r.params.userId),
    );

    app.post('/account/helping/:userId/remove', { schema: linkSchema, preHandler: change }, (r) =>
      service.stopHelping(requireUser(r), r.params.userId),
    );

    app.post(
      '/account/helping/:userId/reset-password',
      {
        schema: {
          params: HelperUserParamsSchema,
          response: { 200: MemberPasswordResetResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('reset')],
      },
      async (request, reply) => {
        const result = await service.resetPassword(requireUser(request), request.params.userId);
        // Shown once; keep it out of any cache.
        return reply.header('cache-control', 'no-store').send(result);
      },
    );

    done();
  };
