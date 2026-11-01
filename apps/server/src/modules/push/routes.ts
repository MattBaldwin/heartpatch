import {
  PushOkResponseSchema,
  PushSettingsPatchSchema,
  PushSettingsSchema,
  PushStatusResponseSchema,
  PushSubscribeRequestSchema,
  PushUnsubscribeRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { PUSH_RATE_LIMITS } from './limits.js';
import type { PushService } from './service.js';

export interface PushRoutesOptions {
  hooks: AuthHooks;
}

/**
 * Push nudges (#726): subscribe this device, unsubscribe it, read and set my
 * switches. NOT_FOUND while push is off for me. No route sends a nudge.
 */
export const pushRoutes =
  (service: PushService, options: PushRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'push', PUSH_RATE_LIMITS);

    app.get(
      '/push',
      {
        schema: { response: { 200: PushStatusResponseSchema } },
        preHandler: [requireAuth, rateLimit('settings')],
      },
      async (request) => service.status(requireUser(request)),
    );

    // This device's subscription, tied to the session that sent it, so
    // logging out (or a password reset) ends its nudges.
    app.put(
      '/push/subscription',
      {
        schema: { body: PushSubscribeRequestSchema, response: { 200: PushOkResponseSchema } },
        preHandler: [requireAuth, rateLimit('subscription')],
      },
      async (request) =>
        service.subscribe(requireUser(request), request.cookies[SESSION_COOKIE], request.body),
    );

    app.delete(
      '/push/subscription',
      {
        schema: { body: PushUnsubscribeRequestSchema, response: { 200: PushOkResponseSchema } },
        preHandler: [requireAuth, rateLimit('subscription')],
      },
      async (request) => service.unsubscribe(requireUser(request), request.body.endpoint),
    );

    app.put(
      '/push/settings',
      {
        schema: { body: PushSettingsPatchSchema, response: { 200: PushSettingsSchema } },
        preHandler: [requireAuth, rateLimit('settings')],
      },
      async (request) => service.updateSettings(requireUser(request), request.body),
    );

    done();
  };
