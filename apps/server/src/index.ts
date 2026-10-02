import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createDbClient, dbReadinessCheck } from './db/client.js';
import { createAuthRepo } from './modules/auth/repo.js';

const config = loadServerConfig();
const db = createDbClient(config.DATABASE_URL);
const app = await buildApp({
  config,
  readinessChecks: [dbReadinessCheck(db)],
  authRepo: createAuthRepo(db.db),
});
// Closing the app (shutdown or failed start) also drains the DB pool.
app.addHook('onClose', () => db.close());

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
