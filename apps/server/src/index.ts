import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createDbClient, dbReadinessCheck } from './db/client.js';
import { startJobs } from './jobs/boss.js';
import { createClock } from './lib/time.js';
import { createRaidsConsumer } from './modules/raids/consumer.js';
import { createTutorialConsumer } from './modules/tutorial/consumer.js';

const config = loadServerConfig();
const db = createDbClient(config.DATABASE_URL);
const clock = createClock(config);
const app = await buildApp({
  config,
  readinessChecks: [dbReadinessCheck(db)],
  db: db.db,
  clock,
});
// Scheduled jobs and event consumers (tech spec §7), in this process.
const jobs = await startJobs({
  connectionString: config.DATABASE_URL,
  db: db.db,
  consumers: [createTutorialConsumer({ clock }), createRaidsConsumer()],
  logger: app.log,
  ...(app.wsHub ? { publish: app.wsHub.publish } : {}),
});
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
