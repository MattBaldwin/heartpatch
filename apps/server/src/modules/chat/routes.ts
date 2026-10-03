import {
  MapIdParamsSchema,
  QuickMessageFeedResponseSchema,
  SendQuickMessageRequestSchema,
  SendQuickMessageResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit, rateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { CHAT_MAP_SEND_LIMIT, CHAT_RATE_LIMITS } from './limits.js';
import type { ChatService } from './service.js';

export interface ChatRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
}

export const chatRoutes =
  (service: ChatService, options: ChatRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);

    const limit = playerRateLimit(fastify, 'chat', CHAT_RATE_LIMITS);
    // After the per-player limit, so one player alone can't use up a map's share.
    const perMap = rateLimit(fastify, [
      {
        limit: CHAT_MAP_SEND_LIMIT,
        key: (request) => `chat:send:map:${MapIdParamsSchema.parse(request.params).mapId}`,
      },
    ]);

    app.get(
      '/maps/:mapId/chat',
      {
        schema: { params: MapIdParamsSchema, response: { 200: QuickMessageFeedResponseSchema } },
        preHandler: [requireAuth, limit('read')],
      },
      async (request) => ({
        messages: await service.feed(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/chat',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SendQuickMessageRequestSchema,
          response: { 200: SendQuickMessageResponseSchema },
        },
        preHandler: [requireAuth, limit('send'), perMap, idempotency.preHandler],
        onSend: idempotency.onSend,
      },
      async (request) => ({
        message: await service.send(
          requireUser(request),
          request.params.mapId,
          request.body.messageId,
        ),
      }),
    );

    done();
  };
