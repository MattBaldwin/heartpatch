import {
  LoginRequestSchema,
  MeResponseSchema,
  RecoverRequestSchema,
  RecoveryCodeResponseSchema,
  SessionResponseSchema,
  SignupRequestSchema,
} from '@heartpatch/shared';
import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { clearSessionCookie, setSessionCookie, type AuthHooks } from './hooks.js';
import { AUTH_RATE_LIMITS, SESSION_COOKIE, type AuthAction, type RateLimit } from './limits.js';
import type { AuthService } from './service.js';

const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

/** The lowercased username from an already-validated body, if any. */
function usernameKey(request: FastifyRequest): string {
  const body = request.body;
  if (typeof body === 'object' && body !== null && 'username' in body) {
    const { username } = body;
    if (typeof username === 'string') return username.trim().toLowerCase();
  }
  return '';
}

export interface AuthRoutesOptions {
  hooks: AuthHooks;
  /** Secure cookies (HTTPS only); true in production. */
  secureCookies: boolean;
  /** Dev and e2e only (`HP_DEV_SIGNUP_LIMIT_PER_IP`): replaces the per-IP signup max. */
  signupPerIpMax?: number;
}

export const authRoutes =
  (service: AuthService, options: AuthRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { secureCookies } = options;

    /**
     * Per-IP and per-username limits for one action (tech spec §5). Runs as a
     * preHandler, after body validation, so the username is known. Each
     * limiter has its own counters.
     */
    const rateLimit = (action: AuthAction): preHandlerAsyncHookHandler => {
      const limiter = (limit: RateLimit, keyGenerator: (request: FastifyRequest) => string) =>
        fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator });
      const limits = AUTH_RATE_LIMITS[action];
      const perIp =
        action === 'signup' && options.signupPerIpMax !== undefined
          ? { ...limits.perIp, max: options.signupPerIpMax }
          : limits.perIp;
      const checks = [
        limiter(perIp, (request) => `ip:${normalizeIP(request.ip)}`),
        limiter(limits.perUsername, (request) => `user:${usernameKey(request)}`),
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

    app.post(
      '/auth/signup',
      {
        schema: { body: SignupRequestSchema, response: { 201: RecoveryCodeResponseSchema } },
        preHandler: rateLimit('signup'),
      },
      async (request, reply) => {
        const result = await service.signup(request.body);
        setSessionCookie(reply, result.session, secureCookies);
        return reply.code(201).send({ user: result.user, recoveryCode: result.recoveryCode });
      },
    );

    app.post(
      '/auth/login',
      {
        schema: { body: LoginRequestSchema, response: { 200: SessionResponseSchema } },
        preHandler: rateLimit('login'),
      },
      async (request, reply) => {
        const result = await service.login(request.body);
        setSessionCookie(reply, result.session, secureCookies);
        return reply.send({ user: result.user });
      },
    );

    app.post(
      '/auth/recover',
      {
        schema: { body: RecoverRequestSchema, response: { 200: RecoveryCodeResponseSchema } },
        preHandler: rateLimit('recover'),
      },
      async (request, reply) => {
        const result = await service.recover(request.body);
        setSessionCookie(reply, result.session, secureCookies);
        return reply.send({ user: result.user, recoveryCode: result.recoveryCode });
      },
    );

    app.post(
      '/auth/logout',
      { schema: { response: { 204: z.null() } } },
      async (request, reply) => {
        await service.logout(request.cookies[SESSION_COOKIE]);
        clearSessionCookie(reply, secureCookies);
        return reply.code(204).send(null);
      },
    );

    // 200 with `user: null` when logged out, so the client can check without an error.
    app.get(
      '/me',
      { schema: { response: { 200: MeResponseSchema } }, preHandler: options.hooks.loadUser },
      (request) => ({ user: request.user }),
    );

    done();
  };
