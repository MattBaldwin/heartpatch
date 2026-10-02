import { BlockList, isIPv6 } from 'node:net';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { registerErrorHandling } from './lib/errors.js';
import { serializerCompiler, validatorCompiler } from './lib/zod.js';
import { createAuthHooks, registerRequestGuards } from './modules/auth/hooks.js';
import type { AuthRepo } from './modules/auth/repo.js';
import { authRoutes } from './modules/auth/routes.js';
import { hashSessionToken } from './modules/auth/secrets.js';
import { createAuthService } from './modules/auth/service.js';
import { healthRoutes } from './modules/health/routes.js';
import { createHealthService, type ReadinessCheck } from './modules/health/service.js';
import { createWsHub, type WsHubOptions } from './ws/hub.js';
import { MAX_CLIENT_MESSAGE_BYTES } from './ws/limits.js';
import { PUBLIC_VIEWS } from './ws/public-views.js';
import type { WsRepo } from './ws/repo.js';
import { wsRoutes } from './ws/routes.js';

export interface BuildAppOptions {
  config: Config;
  /** Dependencies `/ready` must confirm (e.g. `dbReadinessCheck` from `db/client.ts`). */
  readinessChecks?: readonly ReadinessCheck[];
  /**
   * Account storage (`createAuthRepo` from `modules/auth/repo.ts`). Tests that
   * don't touch accounts can omit it; the auth routes are then not registered.
   */
  authRepo?: AuthRepo;
  /**
   * Live sync reads (`createWsRepo` from `ws/repo.ts`). With `authRepo`, it
   * turns on `/ws`; without it there is no live sync.
   */
  wsRepo?: WsRepo;
  /** Tests swap the public views (default `PUBLIC_VIEWS`) and shorten the timings. */
  wsHubOptions?: Partial<
    Pick<WsHubOptions, 'views' | 'heartbeatMs' | 'replayWindow' | 'replayBatch'>
  >;
  /** Clock for sessions; tests can move it. */
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    logger: options.logger ?? defaultLogger(config),
    trustProxy: config.TRUST_PROXY ? trustOneProxyHop : false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  await app.register(cookie);
  // Limits are opted into per route (auth today; care and chat later).
  await app.register(rateLimit, { global: false });

  const health = createHealthService({
    version: config.APP_VERSION,
    checks: options.readinessChecks ?? [],
  });

  // Accounts, live sync and every module that needs a logged-in player need the
  // database; tests that don't touch accounts omit `authRepo`.
  const secureCookies = config.NODE_ENV === 'production';
  const now = options.now ?? (() => new Date());
  const auth = options.authRepo
    ? createAuthService({
        repo: options.authRepo,
        signupCode: config.HP_SIGNUP_CODE,
        now,
      })
    : undefined;
  const authHooks = auth ? createAuthHooks(auth, { secureCookies }) : undefined;

  // Live sync (`/ws`, tech spec §5). Modules call `wsHub.publish(mapId)` after
  // a transaction that appended game events commits (README "Live sync").
  const { authRepo, wsRepo } = options;
  // Looks a session up without renewing it (see `WsRoutesOptions.sessionUser`).
  const sessionUser = async (token: string) =>
    (await authRepo?.findSession(hashSessionToken(token), now()))?.user ?? null;
  const wsHub =
    authRepo && wsRepo
      ? createWsHub({
          repo: wsRepo,
          views: PUBLIC_VIEWS,
          sessionIsValid: async (token) => (await sessionUser(token)) !== null,
          logger: app.log,
          ...options.wsHubOptions,
        })
      : null;
  app.decorate('wsHub', wsHub);
  if (wsHub) {
    // Before @fastify/websocket's own preClose, so players get "going away" (1001).
    app.addHook('preClose', () => wsHub.close());
    await app.register(websocket, { options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES } });
    await app.register(wsRoutes(wsHub, { sessionUser, publicOrigin: config.PUBLIC_ORIGIN }));
  }

  await app.register(
    async (api) => {
      registerRequestGuards(api);
      await api.register(healthRoutes(health));

      // Modules that need a logged-in player (they all need the database too)
      // register inside this block and take `authHooks.requireAuth` (and
      // `wsHub`, if they write game events).
      if (auth && authHooks) {
        await api.register(authRoutes(auth, { hooks: authHooks, secureCookies }));
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}

/** Private and loopback ranges: where Caddy sits on the Docker network. */
const proxyNetworks = new BlockList();
proxyNetworks.addSubnet('10.0.0.0', 8);
proxyNetworks.addSubnet('172.16.0.0', 12);
proxyNetworks.addSubnet('192.168.0.0', 16);
proxyNetworks.addSubnet('127.0.0.0', 8);
proxyNetworks.addSubnet('fc00::', 7, 'ipv6');
proxyNetworks.addAddress('::1', 'ipv6');

/**
 * Exactly one proxy (Caddy) sits in front, so trust one hop: the direct peer,
 * and only when it's on a private network. `trustProxy: true` would trust every
 * X-Forwarded-For entry, letting a client spoof its IP past per-IP rate limits.
 * (Fastify treats a numeric hop count as "trust nothing", so it can't be used.)
 */
export function trustOneProxyHop(address: string, hop: number): boolean {
  return hop === 0 && proxyNetworks.check(address, isIPv6(address) ? 'ipv6' : 'ipv4');
}

function defaultLogger(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  if (config.NODE_ENV === 'development') {
    return { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } };
  }
  return { level: config.LOG_LEVEL };
}
