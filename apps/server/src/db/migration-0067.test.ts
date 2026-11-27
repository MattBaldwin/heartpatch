import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { ownDatabaseUrl } from '../../tests/own-database.js';

const url = ownDatabaseUrl();

// Migration 0067 (#190b) adds `boss_encounters.last_action_at`, nullable and
// expand-only: a row from before it reads as "the battle's start" for the
// ten-minute idle leave (#190 plan §12), so there's nothing to backfill. A
// rollback drops the column.
const migrationSql = readFileSync(join(migrationsFolder, '0067_boss_idle.sql'), 'utf8');

const DOWN = sql`alter table boss_encounters drop column last_action_at`;

describe('migration 0067 (mini-boss idle clock)', () => {
  it('adds one nullable column, backfills nothing and drops no data', () => {
    expect(migrationSql.trim()).toBe(
      'ALTER TABLE "boss_encounters" ADD COLUMN "last_action_at" timestamp with time zone;',
    );
  });

  it.skipIf(!url)('has the column and rolls back by dropping it (needs DATABASE_URL)', async () => {
    const client = createDbClient(url!, { max: 1, quiet: true });
    const count = async (db: { execute: typeof client.db.execute }) =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from information_schema.columns
            where table_name = 'boss_encounters' and column_name = 'last_action_at'
              and is_nullable = 'YES'`,
        )
      )[0]!.n;
    try {
      expect(await count(client.db)).toBe(1);
      await expect(
        client.db.transaction(async (tx) => {
          await tx.execute(DOWN);
          expect(await count(tx)).toBe(0);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
    } finally {
      await client.close();
    }
  });
});
