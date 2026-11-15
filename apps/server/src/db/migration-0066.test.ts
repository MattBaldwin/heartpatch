import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';

const url = inject('testDatabaseUrl');

// Migration 0066 (#190b) adds the `miniboss` battle kind and the three
// mini-boss tables, expand-only: nothing existed before, so there's nothing
// to backfill. Postgres can't use a new enum value in the transaction that
// adds it, so nothing in the migration writes it. A rollback drops the
// tables; the enum value stays (Postgres can't drop one) and is harmless
// with no rows using it (#190 plan §4).
const migrationSql = readFileSync(join(migrationsFolder, '0066_miniboss.sql'), 'utf8');

const TABLES = ['boss_bonds', 'boss_encounters', 'boss_windows'] as const;

/** The plan's down migration (#190 plan §4). */
const DOWN = sql`drop table boss_encounters, boss_bonds, boss_windows`;

describe('migration 0066 (mini-bosses)', () => {
  it('adds the kind and three tables, backfills nothing and drops no data', () => {
    expect(migrationSql).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b|DROP TABLE|DROP COLUMN/m);
    expect(migrationSql).toContain(`ALTER TYPE "public"."battle_kind" ADD VALUE 'miniboss'`);
    for (const table of TABLES) expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    expect(migrationSql).not.toMatch(/ALTER TABLE "(?!boss_)/);
    expect(migrationSql).not.toContain("'miniboss'::");
  });

  it.skipIf(!url)(
    'has the kind and rolls back by dropping the tables (needs DATABASE_URL)',
    async () => {
      const client = createDbClient(url!, { max: 1, quiet: true });
      try {
        const [kind] = await client.db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'battle_kind' and e.enumlabel = 'miniboss'`,
        );
        expect(kind!.n).toBe(1);
        await expect(
          client.db.transaction(async (tx) => {
            await tx.execute(DOWN);
            const [row] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.tables
                where table_name in ('boss_bonds', 'boss_encounters', 'boss_windows')`,
            );
            expect(row!.n).toBe(0);
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await client.close();
      }
    },
  );
});
