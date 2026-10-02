import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { registerErrorHandling } from './lib/errors.js';
import { serializerCompiler, validatorCompiler } from './lib/zod.js';
import { createAuthHooks, registerRequestGuards } from './modules/auth/hooks.js';
import type { Database } from './db/client.js';
import { createClock, type Clock } from './lib/time.js';
import { createAuthRepo } from './modules/auth/repo.js';
import { authRoutes } from './modules/auth/routes.js';
import { createAuthService } from './modules/auth/service.js';
import { healthRoutes } from './modules/health/routes.js';
import { mapsRoutes } from './modules/maps/routes.js';
import { createMapsService } from './modules/maps/service.js';
import { createHealthService, type ReadinessCheck } from './modules/health/service.js';

export interface BuildAppOptions {
  config: Config;
  /** Dependencies `/ready` must confirm (e.g. `dbReadinessCheck` from `db/client.ts`). */
  readinessChecks?: readonly ReadinessCheck[];
  /**
   * The database. Modules build their repos from it (or from a transaction,
   * see `withTransaction`). Tests that don't need a database can omit it; the
   * auth and game routes are then not registered.
   */
  db?: Database;
  /** The game clock; defaults to `createClock(config)` (honours `HP_DEV_NOW`). Tests can move it. */
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const clock = options.clock ?? createClock(config);
  const app = Fastify({
    logger: options.logger ?? defaultLogger(config),
    trustProxy: config.TRUST_PROXY,
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
      const { db } = options;
      if (db) {
        const secureCookies = config.NODE_ENV === 'production';
        const auth = createAuthService({
          repo: createAuthRepo(db),
          signupCode: config.HP_SIGNUP_CODE,
          now: clock,
        });
        const authHooks = createAuthHooks(auth, { secureCookies });
        await api.register(authRoutes(auth, { hooks: authHooks, secureCookies }));

        const maps = createMapsService({
          db,
          tutorialRequired: config.HP_TUTORIAL_REQUIRED,
          clock,
        });
        await api.register(mapsRoutes(maps, { hooks: authHooks }));
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}

function defaultLogger(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  if (config.NODE_ENV === 'development') {
    return { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } };
  }
  return { level: config.LOG_LEVEL };
}
