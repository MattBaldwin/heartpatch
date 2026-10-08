import {
  AdminAuditResponseSchema,
  AdminCodeParamsSchema,
  AdminCreateSignupCodeRequestSchema,
  AdminExtendSignupCodeRequestSchema,
  AdminHollowStrengthRequestSchema,
  AdminInviteResponseSchema,
  AdminListQuerySchema,
  AdminLoginRequestSchema,
  AdminLogoutEverywhereResponseSchema,
  AdminLookupRequestSchema,
  AdminLookupResponseSchema,
  AdminMeResponseSchema,
  AdminPatchDetailSchema,
  AdminPatchParamsSchema,
  AdminPatchesQuerySchema,
  AdminPatchesResponseSchema,
  AdminPlayerDetailSchema,
  AdminPlayerParamsSchema,
  AdminPlayersResponseSchema,
  AdminRequestParamsSchema,
  AdminResetPasswordResponseSchema,
  AdminSignupCodesResponseSchema,
  CreateSignupCodeResponseSchema,
  type AdminMeResponse,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type {
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_PATH,
  ADMIN_LOGIN_LIMITS,
  ADMIN_RATE_LIMITS,
  type AdminRateAction,
} from './limits.js';
import type { AdminContext, AdminService, IssuedAdminSession } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The signed-in admin's session, set by the admin module's gate (#196).
     * Only decorated inside the admin routes, so it's undefined elsewhere.
     */
    admin?: AdminMeResponse | null;
  }
}

export interface AdminRoutesOptions {
  secureCookies: boolean;
}

/** Every admin route but sign-in and sign-out sits behind the gate. */
const FORBIDDEN_MESSAGE = 'Admins only. Sign in to the admin console first.';

/**
 * The operator admin console (#196): `/api/v1/admin/*`. The server is the
 * gate: every route but sign-in and sign-out needs a live admin session
 * (`hp_admin`), re-checked against the account's role on each request, and
 * answers FORBIDDEN otherwise. No route grants or removes the role; only
 * `ops/grant-admin.ts` does.
 */
export const adminRoutes =
  (service: AdminService, options: AdminRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    fastify.decorateRequest('admin', null);

    const setCookie = (reply: FastifyReply, session: IssuedAdminSession) =>
      reply.setCookie(ADMIN_COOKIE, session.token, {
        path: ADMIN_COOKIE_PATH,
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secureCookies,
        expires: session.expiresAt,
      });
    const clearCookie = (reply: FastifyReply) =>
      reply.clearCookie(ADMIN_COOKIE, {
        path: ADMIN_COOKIE_PATH,
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secureCookies,
      });

    // Nothing an admin sees may be kept by a browser or proxy cache.
    fastify.addHook('onSend', (_request, reply, payload, next) => {
      void reply.header('cache-control', 'no-store');
      next(null, payload);
    });

    const requireAdmin: preHandlerAsyncHookHandler = async (request, reply) => {
      const token = request.cookies[ADMIN_COOKIE];
      const me = await service.authenticate(token);
      if (!me) {
        if (token) clearCookie(reply);
        throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
      }
      request.admin = me;
    };

    const ipOf = (request: FastifyRequest) => normalizeIP(request.ip);
    const ctx = (request: FastifyRequest): AdminContext => {
      if (!request.admin) throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
      return { admin: request.admin.admin, ip: ipOf(request) };
    };

    /**
     * One counter per kind, shared by every route of that kind, so the
     * "secret" budget covers resets, reveals, lookups and new codes together.
     */
    const limiters = Object.fromEntries(
      (Object.keys(ADMIN_RATE_LIMITS) as AdminRateAction[]).map((kind) => [
        kind,
        rateLimit(fastify, [
          {
            limit: ADMIN_RATE_LIMITS[kind],
            key: (request) => `admin:${kind}:user:${request.admin?.admin.id ?? ipOf(request)}`,
          },
        ]),
      ]),
    ) as Record<AdminRateAction, preHandlerAsyncHookHandler>;

    /**
     * The gate, then the admin's limit for the kind of request. It runs before
     * validation (`preValidation`), so a non-admin gets 403 whatever they send,
     * never a 400 that says what the route expects.
     */
    const gate = (kind: AdminRateAction) => [requireAdmin, limiters[kind]];

    /** The lowercased username from the validated body (as auth's `usernameKey`). */
    const usernameKey = (request: FastifyRequest): string => {
      const body = request.body;
      if (typeof body === 'object' && body !== null && 'username' in body) {
        const { username } = body;
        if (typeof username === 'string') return username.trim().toLowerCase();
      }
      return '';
    };

    const loginLimit = rateLimit(fastify, [
      { limit: ADMIN_LOGIN_LIMITS.perIp, key: (request) => `admin:login:ip:${ipOf(request)}` },
      {
        limit: ADMIN_LOGIN_LIMITS.perUsername,
        key: (request) => `admin:login:user:${usernameKey(request)}`,
      },
    ]);

    app.post(
      '/admin/login',
      {
        schema: { body: AdminLoginRequestSchema, response: { 200: AdminMeResponseSchema } },
        preHandler: loginLimit,
      },
      async (request, reply) => {
        const { session, me } = await service.login(request.body, ipOf(request));
        setCookie(reply, session);
        return me;
      },
    );

    app.post(
      '/admin/logout',
      { schema: { response: { 204: z.null() } } },
      async (request, reply) => {
        const token = request.cookies[ADMIN_COOKIE];
        const me = await service.authenticate(token);
        await service.logout(token, me?.admin ?? null, ipOf(request));
        clearCookie(reply);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/admin/me',
      { schema: { response: { 200: AdminMeResponseSchema } }, preValidation: gate('read') },
      (request) => {
        if (!request.admin) throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
        return request.admin;
      },
    );

    // --- Patches ---------------------------------------------------------

    app.get(
      '/admin/patches',
      {
        schema: {
          querystring: AdminPatchesQuerySchema,
          response: { 200: AdminPatchesResponseSchema },
        },
        preValidation: gate('read'),
      },
      (request) => service.patches(request.query),
    );

    app.get(
      '/admin/patches/:mapId',
      {
        schema: { params: AdminPatchParamsSchema, response: { 200: AdminPatchDetailSchema } },
        preValidation: gate('read'),
      },
      (request) => service.patch(request.params.mapId),
    );

    app.post(
      '/admin/patches/:mapId/invite/reveal',
      {
        schema: { params: AdminPatchParamsSchema, response: { 200: AdminInviteResponseSchema } },
        preValidation: gate('secret'),
      },
      (request) => service.revealInvite(ctx(request), request.params.mapId),
    );

    app.post(
      '/admin/patches/:mapId/invite',
      {
        schema: { params: AdminPatchParamsSchema, response: { 200: AdminInviteResponseSchema } },
        preValidation: gate('act'),
      },
      (request) => service.newInvite(ctx(request), request.params.mapId),
    );

    app.put(
      '/admin/patches/:mapId/hollow-strength',
      {
        schema: {
          params: AdminPatchParamsSchema,
          body: AdminHollowStrengthRequestSchema,
          response: { 204: z.null() },
        },
        preValidation: gate('act'),
      },
      async (request, reply) => {
        await service.setHollowStrength(ctx(request), request.params.mapId, request.body.percent);
        return reply.code(204).send(null);
      },
    );

    for (const answer of ['approve', 'decline'] as const) {
      app.post(
        `/admin/patches/:mapId/requests/:requestId/${answer}`,
        {
          schema: { params: AdminRequestParamsSchema, response: { 204: z.null() } },
          preValidation: gate('act'),
        },
        async (request, reply) => {
          const { mapId, requestId } = request.params;
          await service.answerRequest(ctx(request), mapId, requestId, answer);
          return reply.code(204).send(null);
        },
      );
    }

    // --- Players ---------------------------------------------------------

    app.get(
      '/admin/players',
      {
        schema: {
          querystring: AdminListQuerySchema,
          response: { 200: AdminPlayersResponseSchema },
        },
        preValidation: gate('read'),
      },
      (request) => service.players(request.query),
    );

    app.get(
      '/admin/players/:userId',
      {
        schema: { params: AdminPlayerParamsSchema, response: { 200: AdminPlayerDetailSchema } },
        preValidation: gate('read'),
      },
      (request) => service.player(request.params.userId),
    );

    app.post(
      '/admin/players/:userId/reset-password',
      {
        schema: {
          params: AdminPlayerParamsSchema,
          response: { 200: AdminResetPasswordResponseSchema },
        },
        preValidation: gate('secret'),
      },
      (request) => service.resetPassword(ctx(request), request.params.userId),
    );

    app.post(
      '/admin/players/:userId/logout-everywhere',
      {
        schema: {
          params: AdminPlayerParamsSchema,
          response: { 200: AdminLogoutEverywhereResponseSchema },
        },
        preValidation: gate('act'),
      },
      (request) => service.logoutEverywhere(ctx(request), request.params.userId),
    );

    app.post(
      '/admin/lookup',
      {
        schema: { body: AdminLookupRequestSchema, response: { 200: AdminLookupResponseSchema } },
        preValidation: gate('secret'),
      },
      (request) => service.lookup(ctx(request), request.body),
    );

    // --- Family codes (#195) -------------------------------------------

    app.get(
      '/admin/signup-codes',
      {
        schema: { response: { 200: AdminSignupCodesResponseSchema } },
        preValidation: gate('read'),
      },
      () => service.signupCodes(),
    );

    app.post(
      '/admin/signup-codes',
      {
        schema: {
          body: AdminCreateSignupCodeRequestSchema,
          response: { 201: CreateSignupCodeResponseSchema },
        },
        preValidation: gate('secret'),
      },
      async (request, reply) =>
        reply.code(201).send(await service.createSignupCode(ctx(request), request.body)),
    );

    app.post(
      '/admin/signup-codes/:codeId/extend',
      {
        schema: {
          params: AdminCodeParamsSchema,
          body: AdminExtendSignupCodeRequestSchema,
          response: { 204: z.null() },
        },
        preValidation: gate('act'),
      },
      async (request, reply) => {
        await service.extendSignupCode(ctx(request), request.params.codeId, request.body.days);
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/admin/signup-codes/:codeId/revoke',
      {
        schema: { params: AdminCodeParamsSchema, response: { 204: z.null() } },
        preValidation: gate('act'),
      },
      async (request, reply) => {
        await service.revokeSignupCode(ctx(request), request.params.codeId);
        return reply.code(204).send(null);
      },
    );

    // --- Audit log -------------------------------------------------------

    app.get(
      '/admin/audit',
      {
        schema: { querystring: AdminListQuerySchema, response: { 200: AdminAuditResponseSchema } },
        preValidation: gate('read'),
      },
      (request) => service.audit(request.query),
    );

    done();
  };
