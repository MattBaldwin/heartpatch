import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createDbClient, dbReadinessCheck } from './db/client.js';
import { startJobs } from './jobs/boss.js';
import { createClock } from './lib/time.js';
import { createHollowConsumer } from './modules/hollow/consumer.js';
import { createLoreConsumer } from './modules/lore/consumer.js';
import { createMilestonesConsumer } from './modules/milestones/consumer.js';
import { createMilestonesService } from './modules/milestones/service.js';
import { relayoutHomes } from './modules/buildings/layout.js';
import { placeMissingTradingPosts } from './modules/maps/trading-posts.js';
import type { HollowService } from './modules/hollow/service.js';
import { createRaidsConsumer } from './modules/raids/consumer.js';
import { createLandTending } from './modules/territory/tending.js';
import { createTutorialConsumer } from './modules/tutorial/consumer.js';

const config = loadServerConfig();
const db = createDbClient(config.DATABASE_URL);
const clock = createClock(config);
let hollowService: HollowService | undefined;
const app = await buildApp({
  config,
  readinessChecks: [dbReadinessCheck(db)],
  db: db.db,
  clock,
  onHollow: (service) => {
    hollowService = service;
  },
});
if (!hollowService) throw new Error('the Hollow Man needs the database');
const hollow = hollowService;
// Land that misses you (owner decision 2026-10-06): long-untended land goes
// wild at nightfall, after the Hollow Man. Its own transaction, safe to rerun.
const land = createLandTending({
  db: db.db,
  clock,
  ...(app.wsHub ? { publish: app.wsHub.publish } : {}),
});
// Scheduled jobs and event consumers (tech spec §7), in this process.
const jobs = await startJobs({
  connectionString: config.DATABASE_URL,
  db: db.db,
  consumers: [
    createTutorialConsumer({ clock }),
    createRaidsConsumer(),
    createHollowConsumer(hollow),
    createLoreConsumer({ clock }),
    createMilestonesConsumer({ clock }),
  ],
  // The Hollow Man (#21): night falls on each map at 19:00 map time (#277).
  // Then the dark land he won back goes wild, then untended land does, up
  // to one cap a night between them; a retry finds the Hollow's night done,
  // skips land already gone and only tops land up to the night's cap.
  nightfall: {
    due: hollow.dueNightfalls,
    run: async (mapId, night) => {
      const taken = await hollow.runNightfall(mapId, night);
      await hollow.reclaim(mapId, night);
      await land.nightfall(mapId, night);
      return taken;
    },
  },
  logger: app.log,
  ...(app.wsHub ? { publish: app.wsHub.publish } : {}),
});
// The First Patch for accounts that finished the tutorial before milestones
// existed (#44). Idempotent, so every boot can run it; it never blocks start.
createMilestonesService({ db: db.db, clock })
  .backfillTutorial((userId, err) => {
    app.log.error({ err, userId }, 'First Patch backfill skipped an account');
  })
  .then(
    (granted) => {
      if (granted > 0) app.log.info({ granted }, 'backfilled The First Patch milestone');
    },
    (err: unknown) => {
      app.log.error({ err }, 'First Patch backfill failed');
    },
  );
// Homes built before today's rules (#202, #204): home fires pack up with a
// full refund, and misplaced buildings move on their own tile. Idempotent,
// so every boot can run it; it never blocks start.
relayoutHomes(db.db, clock, (owner, err) => {
  app.log.error({ err, ...owner }, 'home re-layout skipped a player');
}).then(
  (done) => {
    if (done.packed + done.moved > 0) app.log.info(done, 'tidied homes to the building rules');
  },
  (err: unknown) => {
    app.log.error({ err }, 'home re-layout failed');
  },
);
// Trading posts (#269) for patches made before them. Idempotent, so every
// boot can run it; it never blocks start. A patch with no fair spot free is
// skipped (no land is ever taken) and tried again next boot.
placeMissingTradingPosts(
  db.db,
  (mapId, err) => {
    app.log.error({ err, mapId }, 'trading-post pass skipped a patch');
  },
  app.wsHub?.publish,
).then(
  (done) => {
    if (done.placed > 0)
      app.log.info({ placed: done.placed }, 'placed trading posts on older patches');
    if (done.skipped.length > 0) {
      app.log.warn({ mapIds: done.skipped }, 'no fair spot free for trading posts yet');
    }
  },
  (err: unknown) => {
    app.log.error({ err }, 'trading-post pass failed');
  },
);
// Closing the app (shutdown or failed start) stops the jobs, then drains the DB pool.
app.addHook('onClose', async () => {
  await jobs.stop();
  await db.close();
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  await app.close();
  process.exit(1);
}
