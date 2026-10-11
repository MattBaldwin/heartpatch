import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { canonicalTimeZone } from '../lib/time.js';
import { createDbClient } from './client.js';

const url = inject('testDatabaseUrl');

// Maps store `canonicalTimeZone` output and query `at time zone` with it.
// CI's Postgres is the production image, which ships without tz links, so a
// name ICU returns that isn't a real zone fails here, whatever Node's ICU.
describe('stored time zones', () => {
  it.skipIf(!url)('are names Postgres accepts, for every zone Intl knows', async () => {
    const client = createDbClient(url!, { max: 1 });
    try {
      const names = [...new Set(Intl.supportedValuesOf('timeZone').map(canonicalTimeZone))];
      const rejected: string[] = [];
      for (const name of names) {
        try {
          await client.db.execute(sql`select now() at time zone ${name}`);
        } catch {
          rejected.push(String(name));
        }
      }
      expect(rejected).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
