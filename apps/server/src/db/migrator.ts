import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client.js';

/** Generated SQL migrations; the build copies them next to the compiled code. */
export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Applies every pending migration. Safe to re-run: applied ones are skipped. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
