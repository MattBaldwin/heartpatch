import {
  CreateMapRequestSchema,
  InviteResponseSchema,
  JoinMapRequestSchema,
  JoinMapResponseSchema,
  JoinRequestParamsSchema,
  MapIdParamsSchema,
  MapResponseSchema,
  MapViewSchema,
  MemberParamsSchema,
  MemberPasswordResetResponseSchema,
  MyMapsResponseSchema,
  PvpModeResponseSchema,
  SetPvpModeRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { RateLimit } from '../auth/limits.js';
import { MAP_RATE_LIMITS, type MapAction } from './limits.js';
import type { MapsService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface MapsRoutesOptions {
  hooks: AuthHooks;
}

export const mapsRoutes =
  (service: MapsService, options: MapsRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;

    /** Per-IP and per-player limits for one action; runs after `requireAuth`. */
    const rateLimit = (action: MapAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = MAP_RATE_LIMITS[action];
      const checks = [
        limiter(limits.perIp, (request) => `maps:${action}:ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUser, (request) => `maps:${action}:user:${requireUser(request).id}`),
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
      '/maps',
      { schema: { response: { 200: MyMapsResponseSchema } }, preHandler: requireAuth },
      (request) => service.myMaps(requireUser(request)),
    );

    app.post(
      '/maps',
      {
        schema: { body: CreateMapRequestSchema, response: { 201: MapResponseSchema } },
        preHandler: [requireAuth, rateLimit('create')],
      },
      async (request, reply) => {
        const map = await service.create(requireUser(request), request.body);
        return reply.code(201).send({ map });
      },
    );

    app.post(
      '/maps/join',
      {
        schema: {
          body: JoinMapRequestSchema,
          response: { 200: JoinMapResponseSchema, 201: JoinMapResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('join')],
      },
      async (request, reply) => {
        const result = await service.join(requireUser(request), request.body.code);
        return reply.code(result.created ? 201 : 200).send({ request: result.request });
      },
    );

    app.get(
      '/maps/:mapId',
      {
        schema: { params: MapIdParamsSchema, response: { 200: MapResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        map: await service.get(requireUser(request), request.params.mapId),
      }),
    );

    app.get(
      '/maps/:mapId/view',
      {
        schema: { params: MapIdParamsSchema, response: { 200: MapViewSchema } },
        preHandler: requireAuth,
      },
      (request) => service.view(requireUser(request), request.params.mapId),
    );

    app.post(
      '/maps/:mapId/invite',
      {
        schema: { params: MapIdParamsSchema, response: { 200: InviteResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        invite: await service.regenerateInvite(requireUser(request), request.params.mapId),
      }),
    );

    app.post(
      '/maps/:mapId/invite/revoke',
      {
        schema: { params: MapIdParamsSchema, response: { 204: z.null() } },
        preHandler: requireAuth,
      },
      async (request, reply) => {
        await service.revokeInvite(requireUser(request), request.params.mapId);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/maps/:mapId/requests/:requestId/approve',
      {
        schema: { params: JoinRequestParamsSchema, response: { 204: z.null() } },
        preHandler: requireAuth,
      },
      async (request, reply) => {
        const { mapId, requestId } = request.params;
        await service.approve(requireUser(request), mapId, requestId);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/maps/:mapId/requests/:requestId/deny',
      {
        schema: { params: JoinRequestParamsSchema, response: { 204: z.null() } },
        preHandler: requireAuth,
      },
      async (request, reply) => {
        const { mapId, requestId } = request.params;
        await service.deny(requireUser(request), mapId, requestId);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/maps/:mapId/members/:userId/remove',
      {
        schema: { params: MemberParamsSchema, response: { 204: z.null() } },
        preHandler: requireAuth,
      },
      async (request, reply) => {
        const { mapId, userId } = request.params;
        await service.removeMember(requireUser(request), mapId, userId);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/maps/:mapId/members/:userId/reset-password',
      {
        schema: {
          params: MemberParamsSchema,
          response: { 200: MemberPasswordResetResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('resetPassword')],
      },
      async (request, reply) => {
        const { mapId, userId } = request.params;
        const result = await service.resetMemberPassword(requireUser(request), mapId, userId);
        // Shown once; keep it out of any cache.
        return reply.header('cache-control', 'no-store').send(result);
      },
    );

    app.post(
      '/maps/:mapId/leave',
      {
        schema: { params: MapIdParamsSchema, response: { 204: z.null() } },
        preHandler: requireAuth,
      },
      async (request, reply) => {
        await service.leave(requireUser(request), request.params.mapId);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/maps/:mapId/pvp-mode',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetPvpModeRequestSchema,
          response: { 200: PvpModeResponseSchema },
        },
        preHandler: requireAuth,
      },
      async (request) => ({
        pvpMode: await service.setPvpMode(
          requireUser(request),
          request.params.mapId,
          request.body.pvpMode,
        ),
      }),
    );

    done();
  };
