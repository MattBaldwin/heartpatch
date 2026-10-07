import {
  CreateSignupCodeRequestSchema,
  CreateSignupCodeResponseSchema,
  MySignupCodesResponseSchema,
  SignupCodeParamsSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { SIGNUP_CODE_RATE_LIMITS } from './limits.js';
import type { SignupCodesService } from './service.js';

export interface SignupCodesRoutesOptions {
  hooks: AuthHooks;
}

/** A patch owner's family codes (#195). The operator's are a host script, never HTTP. */
export const signupCodesRoutes =
  (service: SignupCodesService, options: SignupCodesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'signupCodes', SIGNUP_CODE_RATE_LIMITS);

    app.get(
      '/signup-codes',
      { schema: { response: { 200: MySignupCodesResponseSchema } }, preHandler: requireAuth },
      (request) => service.mine(requireUser(request)),
    );

    app.post(
      '/signup-codes',
      {
        schema: {
          body: CreateSignupCodeRequestSchema,
          response: { 201: CreateSignupCodeResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('create')],
      },
      async (request, reply) => {
        const result = await service.create(requireUser(request), request.body.label);
        // Shown once: no cache may keep it.
        return reply.code(201).header('cache-control', 'no-store').send(result);
      },
    );

    app.post(
      '/signup-codes/:codeId/revoke',
      {
        schema: { params: SignupCodeParamsSchema, response: { 204: z.null() } },
        preHandler: [requireAuth, rateLimit('revoke')],
      },
      async (request, reply) => {
        await service.revoke(requireUser(request), request.params.codeId);
        return reply.code(204).send(null);
      },
    );

    done();
  };
