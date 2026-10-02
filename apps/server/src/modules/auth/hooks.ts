import type { PublicUser } from '@heartpatch/shared';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { AppError } from '../../lib/errors.js';
import { SESSION_COOKIE } from './limits.js';
import type { AuthService, IssuedSession } from './service.js';

// The auth contract later modules reuse (apps/server/README.md, "Auth").

declare module 'fastify' {
  interface FastifyRequest {
    /** The logged-in player; set by the `loadUser` / `requireAuth` preHandlers. */
    user: PublicUser | null;
  }
}

export interface AuthHooks {
  /** preHandler: sets `request.user`, or null when logged out. */
  loadUser: preHandlerAsyncHookHandler;
  /** preHandler: sets `request.user`, or responds UNAUTHENTICATED. */
  requireAuth: preHandlerAsyncHookHandler;
}

/** The logged-in player in a handler behind `requireAuth`. */
export function requireUser(request: FastifyRequest): PublicUser {
  if (!request.user) throw new AppError('UNAUTHENTICATED');
  return request.user;
}

export function setSessionCookie(
  reply: FastifyReply,
  session: IssuedSession,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

export function createAuthHooks(
  service: AuthService,
  options: { secureCookies: boolean },
): AuthHooks {
  const load = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    const result = await service.authenticate(token);
    request.user = result?.user ?? null;
    if (result?.renewed) setSessionCookie(reply, result.renewed, options.secureCookies);
    // Drop an expired or revoked token so the browser stops sending it.
    if (token && !result) clearSessionCookie(reply, options.secureCookies);
  };
  return {
    loadUser: load,
    requireAuth: async (request, reply) => {
      await load(request, reply);
      if (!request.user) throw new AppError('UNAUTHENTICATED');
    },
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard (tech spec §5): mutating requests must carry
 * `X-Requested-With: heartpatch`. A cross-site form can't set custom headers,
 * and a cross-site `fetch` that does needs a CORS preflight we never allow.
 */
export function registerRequestGuards(api: FastifyInstance): void {
  api.decorateRequest('user', null);
  api.addHook('onRequest', (request, _reply, done) => {
    const allowed =
      SAFE_METHODS.has(request.method) || request.headers['x-requested-with'] === 'heartpatch';
    done(allowed ? undefined : new AppError('FORBIDDEN'));
  });
}
