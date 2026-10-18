// Test helper (#295): a scratch database migrated up to, not including, one
// migration (`migrateBefore`). Tests that need rows a later migration
// forbids (two buildings on a tile, before migration B's unique index) seed
// them here; the app runs on it as on the full schema when the migration
// left out only adds a constraint.
import { createDbClient, type DbClient } from '../src/db/client.js';
import { migrateBefore } from '../src/db/migrator.js';

export interface ScratchDatabase {
  readonly url: string;
  readonly client: DbClient;
  /** Closes the client and drops the database. */
  readonly drop: () => Promise<void>;
}

/** A new database from `baseUrl`, with every migration before `tag` applied. */
export async function databaseBefore(
  baseUrl: string,
  tag: string,
  options: { readonly max?: number } = {},
): Promise<ScratchDatabase> {
  const name = `heartpatch_before_${tag.slice(0, 4)}_${String(process.pid)}_${String(Date.now())}`;
  const admin = createDbClient(baseUrl, { max: 1, quiet: true });
  await admin.db.execute(`create database "${name}"`);
  const dbUrl = new URL(baseUrl);
  dbUrl.pathname = `/${name}`;
  const client = createDbClient(dbUrl.href, { max: options.max ?? 1, quiet: true });
  const drop = async () => {
    await client.close();
    await admin.db.execute(`drop database if exists "${name}" with (force)`);
    await admin.close();
  };
  try {
    await migrateBefore(client.db, tag);
  } catch (err) {
    await drop();
    throw err;
  }
  return { url: dbUrl.href, client, drop };
}
