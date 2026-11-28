import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LineKindSchema, MAX_LINE_LEVEL, PatchTypeSchema } from '@heartpatch/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ownDatabaseUrl } from '../../tests/own-database.js';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';

const url = ownDatabaseUrl();

// Migration 0072 (#874 C0) adds the Clockwork Isle contracts: the
// `patch_type` value `clockwork-isle` (`ALTER TYPE … ADD VALUE`, committed
// before any row uses it: the gate refuses before a seed is drawn, as Wild
// Isle's 0059), the nullable `tiles.wind` (1–3) and
// `buildings.unpowered_since`, and three new tables: `tile_lines` (wires
// and rails, one of each kind per tile), `research_jobs` (one going per
// player per patch) and `research_known`. Expand-only: the old release
// never reads or writes any of it. A rollback drops the tables, columns and
// CHECK; the enum value can't be dropped and is harmless unused.
const migrationSql = readFileSync(
  join(migrationsFolder, '0072_clockwork_isle_contracts.sql'),
  'utf8',
);

const DOWN = sql.raw(`
  drop table tile_lines, research_jobs, research_known;
  alter table tiles drop constraint tiles_wind_range;
  alter table tiles drop column wind;
  alter table buildings drop column unpowered_since;
`);

describe('migration 0072 (Clockwork Isle contracts)', () => {
  it('adds the patch type, two columns, three tables and their checks, and drops nothing', () => {
    expect(migrationSql).toContain(`ALTER TYPE "public"."patch_type" ADD VALUE 'clockwork-isle';`);
    expect(PatchTypeSchema.options).toContain('clockwork-isle');
    for (const table of ['tile_lines', 'research_jobs', 'research_known']) {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migrationSql).toContain('ALTER TABLE "tiles" ADD COLUMN "wind" smallint;');
    expect(migrationSql).toContain(
      'ALTER TABLE "buildings" ADD COLUMN "unpowered_since" timestamp with time zone;',
    );
    // The CHECK lists every shared line kind, and the level cap matches the data's.
    const kinds = migrationSql.match(/"tile_lines_kind_known" CHECK \(.*\)\),/)?.[0] ?? '';
    for (const kind of LineKindSchema.options) expect(kinds).toContain(`'${kind}'`);
    expect(migrationSql).toContain(`"tile_lines"."level" between 1 and ${String(MAX_LINE_LEVEL)}`);
    const code = migrationSql.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(
      /^\s*(DELETE|TRUNCATE|UPDATE)\b|DROP TABLE|DROP COLUMN|DROP CONSTRAINT|DROP TYPE/im,
    );
  });

  it.skipIf(!url)(
    'holds lines, research and wind to their rules, and rolls back (needs DATABASE_URL)',
    async () => {
      const client = createDbClient(url!, { max: 1, quiet: true });
      try {
        await expect(
          client.db.transaction(async (tx) => {
            const refusedBy = async (name: string, run: () => Promise<unknown>) => {
              // A savepoint each, so a refusal leaves the outer transaction usable.
              const error = await tx
                .transaction(async () => run())
                .then(
                  () => null,
                  (e: unknown) => e,
                );
              expect(String((error as { cause?: unknown } | null)?.cause ?? error)).toContain(name);
            };
            const [kid] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year)
                values (gen_random_uuid(), 'm0072_kid', 'x', 2014) returning id`,
            );
            const [stranger] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year)
                values (gen_random_uuid(), 'm0072_stranger', 'x', 2013) returning id`,
            );
            // The new patch type is usable (0072 is committed in the template).
            const [map] = await tx.execute<{ id: string; patch_type: string }>(
              sql`insert into maps (id, kind, name, time_zone, max_players, patch_type)
                values (gen_random_uuid(), 'multiplayer', 'M0072 Isle', 'UTC', 6, 'clockwork-isle')
                returning id, patch_type`,
            );
            expect(map!.patch_type).toBe('clockwork-isle');
            await tx.execute(sql`insert into map_members (map_id, user_id, role)
              values (${map!.id}, ${kid!.id}, 'owner')`);

            // Wind is 1–3 or null.
            const tile = async (q: number, wind: number | null) => {
              const [row] = await tx.execute<{ id: string }>(
                sql`insert into tiles (id, map_id, q, r, terrain, wind)
                  values (gen_random_uuid(), ${map!.id}, ${q}, 0, 'meadow', ${wind}) returning id`,
              );
              return row!.id;
            };
            const windy = await tile(0, 3);
            await tile(1, null);
            await refusedBy('tiles_wind_range', () => tile(2, 4));
            await refusedBy('tiles_wind_range', () => tile(3, 0));

            // One wire and one rail may share a tile; never two of a kind.
            const line = (kind: string, level = 1, owner = kid!.id) =>
              tx.execute(sql`insert into tile_lines (tile_id, kind, map_id, owner_user_id, level)
                values (${windy}, ${kind}, ${map!.id}, ${owner}, ${level})`);
            await line('wire');
            await line('rail', 2);
            await refusedBy('tile_lines_tile_id_kind_pk', () => line('wire'));
            await refusedBy('tile_lines_kind_known', () => line('road'));
            await refusedBy('tile_lines_level', () =>
              tx.execute(sql`update tile_lines set level = 3 where kind = 'rail'`),
            );
            await refusedBy('tile_lines_owner_member_fk', () =>
              tx
                .execute(sql`delete from tile_lines where kind = 'rail'`)
                .then(() => line('rail', 1, stranger!.id)),
            );

            // A machine's unpowered window is a timestamp.
            const [bench] = await tx.execute<{ id: string; unpowered_since: Date | null }>(
              sql`insert into buildings (id, map_id, owner_user_id, tile_id, building_id, kind, spot)
                values (gen_random_uuid(), ${map!.id}, ${kid!.id}, ${windy}, 'research-bench', 'research', 0)
                returning id, unpowered_since`,
            );
            expect(bench!.unpowered_since).toBeNull();

            // One research going per player per patch; a claimed one frees the slot.
            const job = (node: string, claimed: boolean, ready = sql`now() + interval '2 hours'`) =>
              tx.execute(sql`insert into research_jobs
                (id, map_id, user_id, building_id, node_id, started_at, ready_at, claimed_at)
                values (gen_random_uuid(), ${map!.id}, ${kid!.id}, ${bench!.id}, ${node},
                  now(), ${ready}, ${claimed ? sql`now() + interval '3 hours'` : null})`);
            await job('sorting', false);
            await refusedBy('research_jobs_one_going_key', () => job('bright-bulbs', false));
            await job('tidy-rails', true);
            await refusedBy('research_jobs_ready_after_start', () =>
              job('bright-bulbs', true, sql`now() - interval '1 hour'`),
            );
            await refusedBy('research_jobs_claimed_when_ready', () =>
              job('bright-bulbs', true, sql`now() + interval '4 hours'`),
            );
            await refusedBy('research_jobs_member_fk', () =>
              tx.execute(sql`insert into research_jobs
                (id, map_id, user_id, node_id, started_at, ready_at)
                values (gen_random_uuid(), ${map!.id}, ${stranger!.id}, 'sorting', now(), now())`),
            );
            // A bench taken down leaves its jobs to finish.
            await tx.execute(sql`delete from buildings where id = ${bench!.id}`);
            const [orphans] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from research_jobs
                where map_id = ${map!.id} and building_id is null`,
            );
            expect(orphans!.n).toBe(2);

            // Known once per node.
            const known = (node: string, user = kid!.id) =>
              tx.execute(sql`insert into research_known (map_id, user_id, node_id)
                values (${map!.id}, ${user}, ${node})`);
            await known('tidy-rails');
            await refusedBy('research_known_map_id_user_id_node_id_pk', () => known('tidy-rails'));
            await refusedBy('research_known_member_fk', () => known('sorting', stranger!.id));

            await tx.execute(DOWN);
            const [left] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.tables
                where table_schema = 'public'
                  and table_name in ('tile_lines', 'research_jobs', 'research_known')`,
            );
            expect(left!.n).toBe(0);
            const [columns] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.columns
                where (table_name = 'tiles' and column_name = 'wind')
                  or (table_name = 'buildings' and column_name = 'unpowered_since')`,
            );
            expect(columns!.n).toBe(0);
            // The old release's writes still work after the rollback.
            await tx.execute(sql`insert into tiles (id, map_id, q, r, terrain)
              values (gen_random_uuid(), ${map!.id}, 9, 0, 'meadow')`);
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await client.close();
      }
    },
  );
});
