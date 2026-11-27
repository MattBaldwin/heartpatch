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

            // Warmth: both Keepers are members of the patch, stored ordered.
            const [map] = await tx.execute<{ id: string }>(
              sql`insert into maps (id, kind, name, time_zone, max_players)
                values (gen_random_uuid(), 'tutorial', 'M0070 Hollow', 'UTC', 3) returning id`,
            );
            const [mate] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year)
                values (gen_random_uuid(), 'm0070_mate', 'x', 2013) returning id`,
            );
            const [stranger] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year)
                values (gen_random_uuid(), 'm0070_stranger', 'x', 2013) returning id`,
            );
            await tx.execute(sql`insert into map_members (map_id, user_id, role)
              values (${map!.id}, ${kid!.id}, 'owner'), (${map!.id}, ${mate!.id}, 'member')`);
            const [lo, hi] = [kid!.id, mate!.id].sort();
            const warm = (a: string, b: string) =>
              tx.execute(sql`insert into keeper_warmth (map_id, user_a_id, user_b_id, warmth)
                values (${map!.id}, ${a}, ${b}, 2)`);
            const refusedBy = async (name: string, run: () => Promise<unknown>) => {
              const error = await tx
                .transaction(async () => run())
                .then(
                  () => null,
                  (e: unknown) => e,
                );
              expect(String((error as { cause?: unknown } | null)?.cause ?? error)).toContain(name);
            };
            await warm(lo!, hi!);
            await refusedBy('keeper_warmth_pair_ordered', () => warm(hi!, lo!));
            await refusedBy('keeper_warmth_pair_ordered', () => warm(lo!, lo!));
            const [sLo, sHi] = [kid!.id, stranger!.id].sort();
            await refusedBy('member_fk', () => warm(sLo!, sHi!));
            await refusedBy('keeper_warmth_nonnegative', () =>
              tx.execute(sql`update keeper_warmth set warmth = -1 where map_id = ${map!.id}`),
            );

            // The Patch Tree stands on one of the patch's tiles, one per patch.
            const [tile] = await tx.execute<{ id: string }>(
              sql`insert into tiles (id, map_id, q, r, terrain)
                values (gen_random_uuid(), ${map!.id}, 0, 0, 'meadow') returning id`,
            );
            const tree = () =>
              tx.execute(sql`insert into patch_trees (map_id, post_tile_id)
                values (${map!.id}, ${tile!.id})`);
            await tree();
            await refusedBy('patch_trees_pkey', tree);
            await refusedBy('patch_trees_ornaments_nonnegative', () =>
              tx.execute(sql`update patch_trees set ornaments = -1 where map_id = ${map!.id}`),
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
