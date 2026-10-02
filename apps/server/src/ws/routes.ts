import type { FastifyPluginCallback, onRequestHookHandler } from 'fastify';
import { AppError } from '../lib/errors.js';
import { requireUser, type AuthHooks } from '../modules/auth/hooks.js';
import { SESSION_COOKIE } from '../modules/auth/limits.js';
import type { WsHub } from './hub.js';

export interface WsRoutesOptions {
  hooks: AuthHooks;
  /** `PUBLIC_ORIGIN`: the only page allowed to open the socket. */
  publicOrigin: string;
}

/**
 * `GET /ws` (tech spec §5). The upgrade goes through the normal auth hook, so
 * a logged-out player gets the usual `UNAUTHENTICATED` error instead of a socket.
 */
export const wsRoutes =
  (hub: WsHub, options: WsRoutesOptions): FastifyPluginCallback =>
  (app, _options, done) => {
    const allowedOrigin = new URL(options.publicOrigin).origin;

    // Browsers send the session cookie with a WebSocket from any page on the
    // same site (the GoDaddy homepage on the root domain included), and
    // WebSockets skip CORS. So only our own page may connect (FORBIDDEN).
    const checkOrigin: onRequestHookHandler = (request, _reply, done) => {
      done(request.headers.origin === allowedOrigin ? undefined : new AppError('FORBIDDEN'));
    };

    app.decorateRequest('user', null);
    app.get(
      '/ws',
      { websocket: true, onRequest: checkOrigin, preHandler: options.hooks.requireAuth },
      (socket, request) => {
        const token = request.cookies[SESSION_COOKIE];
        if (token === undefined) throw new AppError('UNAUTHENTICATED');
        hub.accept(socket, requireUser(request), token);
      },
    );

    done();
  };
