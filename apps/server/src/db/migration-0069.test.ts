import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { ownDatabaseUrl } from '../../tests/own-database.js';

const url = ownDatabaseUrl();

// Migration 0069 (#386) adds `raids.attacker_computer`, not null with a
// constant default (expand-only, metadata-only in PG16), and backfills it
// from the challenger's `users.kind` (a mate's row is kept when it leaves and
// `kind` never changes). A rollback drops the column.
const migrationSql = readFileSync(
  join(migrationsFolder, '0069_raid_attacker_computer.sql'),
  'utf8',
);
const statements = migrationSql.split('--> statement-breakpoint').map((s) => s.trim());
const backfill = statements[1]!;

const DOWN = sql`alter table raids drop column attacker_computer`;

describe('migration 0069 (raid attacker is a Computer friend)', () => {
  it('adds one defaulted column and one backfill, and drops no data', () => {
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      'ALTER TABLE "raids" ADD COLUMN "attacker_computer" boolean DEFAULT false NOT NULL;',
    );
    expect(backfill).toMatch(/UPDATE "raids" AS "r" SET "attacker_computer" = true\s+FROM "users"/);
    const code = migrationSql.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });

  it.skipIf(!url)(
    'backfills from users.kind and rolls back by dropping it (needs DATABASE_URL)',
    async () => {
      const client = createDbClient(url!, { max: 1, quiet: true });
      const count = async (db: { execute: typeof client.db.execute }) =>
        (
          await db.execute<{ n: number }>(
            sql`select count(*)::int as n from information_schema.columns
            where table_schema = 'public' and table_name = 'raids'
              and column_name = 'attacker_computer' and is_nullable = 'NO'`,
          )
        )[0]!.n;
      try {
        expect(await count(client.db)).toBe(1);
        await expect(
          client.db.transaction(async (tx) => {
            // A temp `raids` shadows the real one (pg_temp is searched first),
            // so the backfill runs as written without a whole patch and battle.
            await tx.execute(sql`create temp table raids (
            attacker_user_id uuid not null,
            attacker_computer boolean not null default false
          ) on commit drop`);
            const [mate] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, kind) values (gen_random_uuid(), 'm0069_mate', 'computer') returning id`,
            );
            const [kid] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year) values (gen_random_uuid(), 'm0069_kid', 'x', 2014) returning id`,
            );
            await tx.execute(
              sql`insert into raids (attacker_user_id) values (${mate!.id}), (${kid!.id})`,
            );
            await tx.execute(sql.raw(backfill));
            const rows = await tx.execute<{ attacker_user_id: string; attacker_computer: boolean }>(
              sql`select attacker_user_id, attacker_computer from raids`,
            );
            expect(
              Object.fromEntries(rows.map((r) => [r.attacker_user_id, r.attacker_computer])),
            ).toEqual({
              [mate!.id]: true,
              [kid!.id]: false,
            });
            await tx.execute(sql`drop table pg_temp.raids`);
            await tx.execute(DOWN);
            expect(await count(tx)).toBe(0);
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await client.close();
      }
    },
  );
});
