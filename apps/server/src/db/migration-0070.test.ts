import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PushKindSchema } from '@heartpatch/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';

const url = inject('testDatabaseUrl');

// Migration 0070 (#37 C0) adds the Christmas tables (`advent_claims`,
// `keeper_warmth`, `patch_trees`), the `push_settings.christmas` switch (not
// null, constant default: metadata-only in PG16) and two kinds on the
// `push_sends` CHECK. Expand-only: the old release never writes the new
// kinds or tables, and the wider CHECK accepts all it does write. A rollback
// drops the tables and the column, deletes any send-log rows of the new
// kinds (a fortnight's log, nothing a player keeps) and puts back the old
// CHECK.
const migrationSql = readFileSync(join(migrationsFolder, '0070_christmas_contracts.sql'), 'utf8');

const TABLES = ['advent_claims', 'keeper_warmth', 'patch_trees'] as const;
const OLD_KINDS = `'dusk', 'gatherers', 'friend', 'long-night-soon', 'long-night-start'`;

const DOWN = sql.raw(`
  drop table advent_claims, keeper_warmth, patch_trees;
  alter table push_settings drop column christmas;
  delete from push_sends where kind in ('present', 'christmas-eve');
  alter table push_sends drop constraint push_sends_kind_known;
  alter table push_sends add constraint push_sends_kind_known check (kind in (${OLD_KINDS}));
`);

describe('migration 0070 (Christmas contracts)', () => {
  it('adds three tables, one column and a wider CHECK, and drops no data', () => {
    for (const table of TABLES) expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    expect(migrationSql).toContain(
      'ALTER TABLE "push_settings" ADD COLUMN "christmas" boolean DEFAULT true NOT NULL;',
    );
    // The latest send-log CHECK lists every shared push kind.
    const check = migrationSql.match(/"push_sends_kind_known" CHECK \(.*\)\);/)?.[0] ?? '';
    for (const kind of PushKindSchema.options) expect(check).toContain(`'${kind}'`);
    const code = migrationSql.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/^\s*(DELETE|TRUNCATE|UPDATE)\b|DROP TABLE|DROP COLUMN/im);
    // The only thing dropped is the CHECK it widens.
    expect(code.match(/DROP CONSTRAINT "([a-z_]+)"/g)).toEqual([
      'DROP CONSTRAINT "push_sends_kind_known"',
    ]);
  });

  it.skipIf(!url)(
    'keeps one present per account per day, one catch-up a day, and rolls back (needs DATABASE_URL)',
    async () => {
      const client = createDbClient(url!, { max: 1, quiet: true });
      try {
        await expect(
          client.db.transaction(async (tx) => {
            const [kid] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year)
                values (gen_random_uuid(), 'm0070_kid', 'x', 2014) returning id`,
            );
            const claim = (day: string, claimedOn: string, catchUp: boolean) =>
              tx.execute(sql`insert into advent_claims
                (id, user_id, day, map_id, seed, result, catch_up, claimed_on, claimed_at)
                values (gen_random_uuid(), ${kid!.id}, ${day}, null, 's', '{"treats":1}'::jsonb,
                  ${catchUp}, ${claimedOn}, now())`);
            const refused = async (run: () => Promise<unknown>) => {
              // A savepoint each, so a refusal leaves the outer transaction usable.
              await expect(tx.transaction(async () => run())).rejects.toThrow();
            };
            await claim('2026-12-03', '2026-12-03', false);
            await claim('2026-12-01', '2026-12-03', true);
            // Same day again (any patch): refused at account level.
            await refused(() => claim('2026-12-03', '2026-12-04', true));
            // A second catch-up the same day.
            await refused(() => claim('2026-12-02', '2026-12-03', true));
            // Outside advent, early, or labelled wrong.
            await refused(() => claim('2026-12-26', '2026-12-26', false));
            await refused(() => claim('2026-11-30', '2026-11-30', false));
            await refused(() => claim('2026-12-05', '2026-12-04', false));
            await refused(() => claim('2026-12-05', '2026-12-06', false));
            await refused(() => claim('2026-12-05', '2026-12-05', true));
            // A catch-up the next day is fine.
            await claim('2026-12-02', '2026-12-04', true);

            // Warmth is stored ordered.
            await refused(() =>
              tx.execute(sql`insert into keeper_warmth (map_id, user_a_id, user_b_id)
                values (gen_random_uuid(), ${kid!.id}, ${kid!.id})`),
            );

            // The switch defaults on; the send log takes the new kinds.
            const [settings] = await tx.execute<{ christmas: boolean }>(
              sql`insert into push_settings (user_id) values (${kid!.id}) returning christmas`,
            );
            expect(settings!.christmas).toBe(true);
            for (const kind of ['present', 'christmas-eve']) {
              await tx.execute(sql`insert into push_sends (id, user_id, kind, dedupe_key, claimed_at)
                values (gen_random_uuid(), ${kid!.id}, ${kind}, 'k', now())`);
            }
            await refused(() =>
              tx.execute(sql`insert into push_sends (id, user_id, kind, dedupe_key, claimed_at)
                values (gen_random_uuid(), ${kid!.id}, 'nag', 'k', now())`),
            );

            await tx.execute(DOWN);
            const [left] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.tables
                where table_schema = 'public'
                  and table_name in ('advent_claims', 'keeper_warmth', 'patch_trees')`,
            );
            expect(left!.n).toBe(0);
            const [column] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.columns
                where table_name = 'push_settings' and column_name = 'christmas'`,
            );
            expect(column!.n).toBe(0);
            await refused(() =>
              tx.execute(sql`insert into push_sends (id, user_id, kind, dedupe_key, claimed_at)
                values (gen_random_uuid(), ${kid!.id}, 'present', 'k2', now())`),
            );
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await client.close();
      }
    },
  );
});
