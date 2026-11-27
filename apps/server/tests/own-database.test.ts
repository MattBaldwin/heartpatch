import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from '../src/db/client.js';
import { ownDatabaseUrl } from './own-database.js';

const shared = inject('testDatabaseUrl');
const url = ownDatabaseUrl();

// #895: migration tests run their DDL in a database of their own, so the
// locks it takes never reach the shared database other test files use.
describe('a test file’s own database', () => {
  it('is there exactly when the shared one is', () => {
    expect(url === null).toBe(shared === null);
  });

  it.skipIf(!url)(
    'is a migrated copy, and DDL there never reaches the shared one (needs DATABASE_URL)',
    async () => {
      const ownName = new URL(url!).pathname.slice(1);
      const sharedName = new URL(shared!).pathname.slice(1);
      // Named after the run, so global teardown can sweep it up.
      expect(ownName.startsWith(`${sharedName}_own_`)).toBe(true);
      expect(ownName.length).toBeLessThanOrEqual(63);

      const own = createDbClient(url!, { max: 1, quiet: true });
      const other = createDbClient(shared!, { max: 1, quiet: true });
      const migrations = async (db: typeof own.db) =>
        [
          ...(await db.execute<{ n: number }>(
            'select count(*)::int as n from drizzle.__drizzle_migrations',
          )),
        ][0]!.n;
      const tables = (db: typeof own.db) =>
        db.execute<{ n: number }>(
          "select count(*)::int as n from pg_tables where tablename = 'own_database_probe'",
        );
      try {
        const [current] = await own.db.execute<{ db: string }>('select current_database() as db');
        expect(current!.db).toBe(ownName);
        expect(await migrations(own.db)).toBeGreaterThan(0);
        expect(await migrations(own.db)).toBe(await migrations(other.db));

        await own.db.execute('create table own_database_probe (id int)');
        expect([...(await tables(own.db))][0]!.n).toBe(1);
        expect([...(await tables(other.db))][0]!.n).toBe(0);
      } finally {
        await own.close();
        await other.close();
      }
    },
  );
});
