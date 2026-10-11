import {
  AnswerChallengeRequestSchema,
  AnswerChallengeResponseSchema,
  ChallengeIdParamsSchema,
  ChallengeResponseSchema,
  ChallengesResponseSchema,
  FriendlyChallengesResponseSchema,
  MapIdParamsSchema,
  SendChallengeRequestSchema,
  SetFriendlyChallengesRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { CHALLENGE_RATE_LIMITS } from './limits.js';
import type { ChallengesService } from './service.js';

export interface ChallengesRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

/** Friendly battles: who's here now, "Battle me?", and the owner's switch (#29). */
export const challengesRoutes =
  (service: ChallengesService, options: ChallengesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'challenges', CHALLENGE_RATE_LIMITS);
    const command = (action: keyof typeof CHALLENGE_RATE_LIMITS) => ({
      preHandler: [requireAuth, rateLimit(action), idempotency.preHandler],
      onSend: idempotency.onSend,
    });

    app.get(
      '/maps/:mapId/challenges',
      {
        schema: { params: MapIdParamsSchema, response: { 200: ChallengesResponseSchema } },
        // A read that may expire asks first (a write): limited.
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/challenges',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SendChallengeRequestSchema,
          response: { 201: ChallengeResponseSchema },
        },
        ...command('send'),
      },
      async (request, reply) => {
        const challenge = await service.send(
          requireUser(request),
          request.params.mapId,
          request.body,
        );
        return reply.code(201).send({ challenge });
      },
    );

    app.post(
      '/challenges/:challengeId/answer',
      {
        schema: {
          params: ChallengeIdParamsSchema,
          body: AnswerChallengeRequestSchema,
          response: { 200: AnswerChallengeResponseSchema },
        },
        ...command('answer'),
      },
      async (request) =>
        service.answer(requireUser(request), request.params.challengeId, request.body),
    );

    app.post(
      '/challenges/:challengeId/cancel',
      { schema: { params: ChallengeIdParamsSchema }, ...command('answer') },
      async (request, reply) => {
        await service.cancel(requireUser(request), request.params.challengeId);
        return reply.code(204).send();
      },
    );

    app.post(
      '/maps/:mapId/friendly-challenges',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetFriendlyChallengesRequestSchema,
          response: { 200: FriendlyChallengesResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('owner')],
      },
      async (request) => ({
        friendlyChallenges: await service.setFriendly(
          requireUser(request),
          request.params.mapId,
          request.body.friendlyChallenges,
        ),
      }),
    );

    done();
  };
