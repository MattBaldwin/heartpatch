import type { PublicUser } from '@heartpatch/shared';
import type {
  FastifyPluginCallback,
  onRequestHookHandler,
  preHandlerAsyncHookHandler,
} from 'fastify';
import { AppError } from '../lib/errors.js';
import { requireUser } from '../modules/auth/hooks.js';
import { SESSION_COOKIE } from '../modules/auth/limits.js';
import type { WsHub } from './hub.js';

export interface WsRoutesOptions {
  /**
   * The player behind a session token, **without** renewing it. The upgrade
   * can't carry a `Set-Cookie` (the 101 is written by ws, not Fastify), so a
   * renewal here would slide the stored expiry while the browser's cookie
   * keeps the old one. REST requests do the renewing.
   */
  sessionUser: (sessionToken: string) => Promise<PublicUser | null>;
  /** `PUBLIC_ORIGIN`: the only page allowed to open the socket. */
  publicOrigin: string;
}

/**
 * `GET /ws` (tech spec §5). A logged-out player gets the usual
 * `UNAUTHENTICATED` error instead of a socket.
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

    const requireSession: preHandlerAsyncHookHandler = async (request) => {
      const token = request.cookies[SESSION_COOKIE];
      request.user = token ? await options.sessionUser(token) : null;
      if (!request.user) throw new AppError('UNAUTHENTICATED');
    };

    app.decorateRequest('user', null);
    app.get(
      '/ws',
      { websocket: true, onRequest: checkOrigin, preHandler: requireSession },
      (socket, request) => {
        const token = request.cookies[SESSION_COOKIE];
        if (token === undefined) throw new AppError('UNAUTHENTICATED');
        hub.accept(socket, requireUser(request), token);
      },
    );

    done();
  };
