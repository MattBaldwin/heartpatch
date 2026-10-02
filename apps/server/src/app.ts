import { BlockList, isIPv6 } from 'node:net';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { registerErrorHandling } from './lib/errors.js';
import { serializerCompiler, validatorCompiler } from './lib/zod.js';
import { createAuthHooks, registerRequestGuards } from './modules/auth/hooks.js';
import type { AuthRepo } from './modules/auth/repo.js';
import { authRoutes } from './modules/auth/routes.js';
import { createAuthService } from './modules/auth/service.js';
import { healthRoutes } from './modules/health/routes.js';
import { createHealthService, type ReadinessCheck } from './modules/health/service.js';

export interface BuildAppOptions {
  config: Config;
  /** Dependencies `/ready` must confirm (e.g. `dbReadinessCheck` from `db/client.ts`). */
  readinessChecks?: readonly ReadinessCheck[];
  /**
   * Account storage (`createAuthRepo` from `modules/auth/repo.ts`). Tests that
   * don't touch accounts can omit it; the auth routes are then not registered.
   */
  authRepo?: AuthRepo;
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

  await app.register(
    async (api) => {
      registerRequestGuards(api);
      await api.register(healthRoutes(health));

      // Modules that need a logged-in player (they all need the database too)
      // register inside this block and take `authHooks.requireAuth`.
      if (options.authRepo) {
        const secureCookies = config.NODE_ENV === 'production';
        const auth = createAuthService({
          repo: options.authRepo,
          signupCode: config.HP_SIGNUP_CODE,
          ...(options.now ? { now: options.now } : {}),
        });
        const authHooks = createAuthHooks(auth, { secureCookies });
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
