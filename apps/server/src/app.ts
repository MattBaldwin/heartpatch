import { BlockList, isIPv6 } from 'node:net';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { registerErrorHandling } from './lib/errors.js';
import { serializerCompiler, validatorCompiler } from './lib/zod.js';
import { createAuthHooks, registerRequestGuards } from './modules/auth/hooks.js';
import type { Database } from './db/client.js';
import { createClock, type Clock } from './lib/time.js';
import { createIdempotencyStore } from './db/idempotency-keys.js';
import { registerIdempotency } from './lib/idempotency.js';
import { battlesRoutes } from './modules/battles/routes.js';
import { buildingsRoutes } from './modules/buildings/routes.js';
import { createBuildingsService } from './modules/buildings/service.js';
import { createBattlesService } from './modules/battles/service.js';
import { gatheringRoutes } from './modules/gathering/routes.js';
import { createGatheringService } from './modules/gathering/service.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { createInventoryService } from './modules/inventory/service.js';
import { spawnsRoutes } from './modules/spawns/routes.js';
import { createSpawnsService } from './modules/spawns/service.js';
import { createAuthRepo } from './modules/auth/repo.js';
import { authRoutes } from './modules/auth/routes.js';
import { hashSessionToken } from './modules/auth/secrets.js';
import { createAuthService } from './modules/auth/service.js';
import { healthRoutes } from './modules/health/routes.js';
import { keepersRoutes } from './modules/keepers/routes.js';
import { createKeepersService } from './modules/keepers/service.js';
import { mapsRoutes } from './modules/maps/routes.js';
import { createMapsService } from './modules/maps/service.js';
import { createHealthService, type ReadinessCheck } from './modules/health/service.js';
import { tutorialRoutes } from './modules/tutorial/routes.js';
import { createTutorialService } from './modules/tutorial/service.js';
import { createWsHub, type WsHubOptions } from './ws/hub.js';
import { MAX_CLIENT_MESSAGE_BYTES } from './ws/limits.js';
import { PUBLIC_VIEWS } from './ws/public-views.js';
import { createWsRepo } from './ws/repo.js';
import { wsRoutes } from './ws/routes.js';

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
  /** Tests swap the public views (default `PUBLIC_VIEWS`) and shorten the timings. */
  wsHubOptions?: Partial<
    Pick<WsHubOptions, 'views' | 'heartbeatMs' | 'replayWindow' | 'replayBatch'>
  >;
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
  // database; tests that don't touch accounts omit `db`.
  const { db } = options;
  const secureCookies = config.NODE_ENV === 'production';
  const authRepo = db ? createAuthRepo(db) : undefined;
  const auth = authRepo
    ? createAuthService({ repo: authRepo, signupCode: config.HP_SIGNUP_CODE, now: clock })
    : undefined;
  const authHooks = auth ? createAuthHooks(auth, { secureCookies }) : undefined;

  // Live sync (`/ws`, tech spec §5). Modules call `wsHub.publish(mapId)` after
  // a transaction that appended game events commits (README "Live sync").
  // Looks a session up without renewing it (see `WsRoutesOptions.sessionUser`).
  const sessionUser = async (token: string) =>
    (await authRepo?.findSession(hashSessionToken(token), clock()))?.user ?? null;
  const wsHub =
    db && authRepo
      ? createWsHub({
          repo: createWsRepo(db),
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
      if (db && auth && authHooks) {
        await api.register(
          authRoutes(auth, {
            hooks: authHooks,
            secureCookies,
            ...(config.HP_DEV_SIGNUP_LIMIT_PER_IP !== undefined
              ? { signupPerIpMax: config.HP_DEV_SIGNUP_LIMIT_PER_IP }
              : {}),
          }),
        );

        const keepers = createKeepersService({ db, clock });
        await api.register(keepersRoutes(keepers, { hooks: authHooks }));

        const maps = createMapsService({
          db,
          tutorialRequired: config.HP_TUTORIAL_REQUIRED,
          keeperRequired: config.HP_KEEPER_REQUIRED,
          clock,
          ...(wsHub ? { publish: wsHub.publish } : {}),
        });
        await api.register(mapsRoutes(maps, { hooks: authHooks }));

        const tutorial = createTutorialService({
          db,
          tutorialRequired: config.HP_TUTORIAL_REQUIRED,
          clock,
          ...(wsHub ? { publish: wsHub.publish } : {}),
        });
        await api.register(tutorialRoutes(tutorial, { hooks: authHooks }));

        // Wild squishies (#14) plug into battles through `findWildEncounter`.
        const spawns = createSpawnsService({ db, clock });
        await api.register(spawnsRoutes(spawns, { hooks: authHooks }));
        const battles = createBattlesService({
          db,
          clock,
          findWildEncounter: spawns.findWildEncounter,
          ...(wsHub ? { publish: wsHub.publish } : {}),
        });
        const idempotencyStore = createIdempotencyStore(db);
        await api.register(
          battlesRoutes(battles, {
            hooks: authHooks,
            idempotency: (plugin) =>
              registerIdempotency(plugin, { store: idempotencyStore, clock }),
            devGrants: config.HP_DEV_SQUISHY_GRANTS,
          }),
        );

        const publish = wsHub ? { publish: wsHub.publish } : {};
        const idempotency = (plugin: Parameters<typeof registerIdempotency>[0]) =>
          registerIdempotency(plugin, { store: idempotencyStore, clock });
        await api.register(
          inventoryRoutes(createInventoryService({ db, clock, ...publish }), {
            hooks: authHooks,
            idempotency,
            devGrants: config.HP_DEV_SQUISHY_GRANTS,
          }),
        );
        await api.register(
          gatheringRoutes(createGatheringService({ db, clock, ...publish }), {
            hooks: authHooks,
            idempotency,
          }),
        );
        await api.register(
          buildingsRoutes(createBuildingsService({ db, clock, ...publish }), {
            hooks: authHooks,
            idempotency,
          }),
        );
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
