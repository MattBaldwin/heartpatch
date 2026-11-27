import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { ownDatabaseUrl } from '../../tests/own-database.js';

const url = ownDatabaseUrl();

// Migration 0065 (#729a) adds the trading post Shop's `post_purchases` table,
// expand-only: nothing existed before, so there's nothing to backfill, and a
// rollback runs the previous image, which never reads the table.
const migrationSql = readFileSync(join(migrationsFolder, '0065_post_shop.sql'), 'utf8');

/** The plan's down migration (#729 §3). */
const DOWN = sql`drop table post_purchases`;

describe('migration 0065 (post shop)', () => {
  it('adds one table, backfills nothing and drops no data', () => {
    expect(migrationSql).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b|DROP TABLE|DROP COLUMN/m);
    expect(migrationSql).toContain('CREATE TABLE "post_purchases"');
    expect(migrationSql).not.toMatch(/ALTER TABLE "(?!post_purchases)/);
    expect(migrationSql).toContain(
      `WHERE "post_purchases"."item_id" = 'rare-lure' and "post_purchases"."consumed_at" is null`,
    );
  });

  it.skipIf(!url)('rolls back by dropping the table (needs DATABASE_URL)', async () => {
    const client = createDbClient(url!, { max: 1, quiet: true });
    try {
      await expect(
        client.db.transaction(async (tx) => {
          await tx.execute(DOWN);
          const [row] = await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from information_schema.tables where table_name = 'post_purchases'`,
          );
          expect(row!.n).toBe(0);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
    } finally {
      await client.close();
    }
  });
});
