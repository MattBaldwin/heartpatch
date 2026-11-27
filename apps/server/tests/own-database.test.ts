import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from '../src/db/client.js';
import { ownDatabaseUrl } from './own-database.js';

const shared = inject('testDatabaseUrl');
const url = ownDatabaseUrl();

// #895: migration tests run their DDL here, so the locks it takes never reach
// the shared database the other test files use at the same time.
describe('a test file’s own database', () => {
  it('is there exactly when the shared one is', () => {
    expect(url === null).toBe(shared === null);
  });

  it.skipIf(!url)(
    'is migrated, and its DDL locks leave the shared database free (needs DATABASE_URL)',
    async () => {
      expect(new URL(url!).pathname).not.toBe(new URL(shared!).pathname);
      const own = createDbClient(url!, { max: 1, quiet: true });
      const other = createDbClient(shared!, { max: 1, quiet: true });
      try {
        await expect(
          own.db.transaction(async (tx) => {
            // What a DOWN that drops a foreign key to `map_members` holds.
            await tx.execute('lock table map_members in access exclusive mode');
            // On the shared database this read would wait for the lock.
            await other.db.transaction(async (read) => {
              await read.execute("set local lock_timeout = '2s'");
              await read.execute('select count(*) from map_members');
            });
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await own.close();
        await other.close();
      }
    },
  );
});
