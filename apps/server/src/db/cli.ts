// Database commands: `node dist/db/cli.js migrate|seed` (or `pnpm db:migrate`,
// `pnpm db:seed` from the repo root). Deploy runs `migrate` in a one-off
// container before switching images (tech spec §12).
import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createDbClient } from './client.js';
import { runMigrations } from './migrator.js';
import { seed } from './seed.js';

const log = pino({ name: 'db' });
const command = process.argv[2];

if (command !== 'migrate' && command !== 'seed') {
  log.fatal({ command }, 'usage: cli.ts migrate|seed');
  process.exit(2);
}

const config = loadConfig();
if (command === 'seed' && config.NODE_ENV === 'production') {
  log.fatal('refusing to seed test data with NODE_ENV=production');
  process.exit(1);
}

const client = createDbClient(config.DATABASE_URL, { max: 1, quiet: true });
try {
  if (command === 'migrate') {
    await runMigrations(client.db);
    log.info('migrations applied');
  } else {
    const result = await seed(client.db);
    log.info(result, result.created ? 'seeded test map' : 'test map already seeded');
  }
} catch (err) {
  log.fatal({ err }, `${command} failed`);
  process.exitCode = 1;
} finally {
  await client.close();
}
