import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BossBarStateSchema, BossWindowKindSchema } from '@heartpatch/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';

const url = inject('testDatabaseUrl');

// Migration 0071 (#37 C0b) adds the Christmas Eve patch bar: `boss_bars`,
// `boss_bar_chips`, `boss_windows.kind` (not null, constant default
// 'weekly': metadata-only in PG16, so every stored visit stays weekly) with
// its CHECK and a one-Christmas-Eve-a-year partial unique index, and the
// nullable `boss_encounters.thanked_at`. Expand-only: the old release never
// writes the new tables or column and its weekly inserts take the default.
// A rollback drops the tables, the index and the columns; no row a player
// keeps is lost (the old release has no Christmas Eve to remember).
const migrationSql = readFileSync(
  join(migrationsFolder, '0071_christmas_eve_contracts.sql'),
  'utf8',
);

const DOWN = sql.raw(`
  drop table boss_bar_chips, boss_bars;
  drop index boss_windows_one_christmas_eve_key;
  alter table boss_windows drop constraint boss_windows_kind_known;
  alter table boss_windows drop column kind;
  alter table boss_encounters drop column thanked_at;
`);

describe('migration 0071 (Christmas Eve contracts)', () => {
  it('adds two tables, two columns, a CHECK and an index, and drops nothing', () => {
    for (const table of ['boss_bars', 'boss_bar_chips']) {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migrationSql).toContain(
      'ALTER TABLE "boss_windows" ADD COLUMN "kind" text DEFAULT \'weekly\' NOT NULL;',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "boss_encounters" ADD COLUMN "thanked_at" timestamp with time zone;',
    );
    // The CHECKs list every shared kind and state.
    const kinds = migrationSql.match(/"boss_windows_kind_known" CHECK \(.*\)\);/)?.[0] ?? '';
    for (const kind of BossWindowKindSchema.options) expect(kinds).toContain(`'${kind}'`);
    const states = migrationSql.match(/"boss_bars_state_known" CHECK \(.*\)\),/)?.[0] ?? '';
    for (const state of BossBarStateSchema.options) expect(states).toContain(`'${state}'`);
    const code = migrationSql.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(
      /^\s*(DELETE|TRUNCATE|UPDATE)\b|DROP TABLE|DROP COLUMN|DROP CONSTRAINT/im,
    );
  });

  it.skipIf(!url)(
    'keeps one bar per visit, one chip per fight, sane states, and rolls back (needs DATABASE_URL)',
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
                values (gen_random_uuid(), 'm0071_kid', 'x', 2014) returning id`,
            );
            const [stranger] = await tx.execute<{ id: string }>(
              sql`insert into users (id, username, password_hash, birth_year)
                values (gen_random_uuid(), 'm0071_stranger', 'x', 2013) returning id`,
            );
            const [map] = await tx.execute<{ id: string }>(
              sql`insert into maps (id, kind, name, time_zone, max_players)
                values (gen_random_uuid(), 'tutorial', 'M0071 Hollow', 'UTC', 3) returning id`,
            );
            await tx.execute(sql`insert into map_members (map_id, user_id, role)
              values (${map!.id}, ${kid!.id}, 'owner')`);

            // A weekly insert as the old release writes it takes the default.
            const visit = (windowId: string, kind?: string) =>
              kind === undefined
                ? tx.execute(sql`insert into boss_windows
                    (map_id, window_id, species_id, q, r, opens_at, ends_at)
                    values (${map!.id}, ${windowId}, 'papa-brrr', 0, 0, now(), now() + interval '2 days')`)
                : tx.execute(sql`insert into boss_windows
                    (map_id, window_id, species_id, q, r, opens_at, ends_at, kind)
                    values (${map!.id}, ${windowId}, 'snowdrift', 0, 0, now(), now() + interval '18 hours', ${kind})`);
            await visit('2026-12-14');
            const [weekly] = await tx.execute<{ kind: string }>(
              sql`select kind from boss_windows where map_id = ${map!.id} and window_id = '2026-12-14'`,
            );
            expect(weekly!.kind).toBe('weekly');
            await refusedBy('boss_windows_kind_known', () => visit('2026-12-07', 'easter'));
            await visit('2026-12-21', 'christmas-eve');
            // A second Christmas Eve that year is refused; next year is fine.
            await refusedBy('boss_windows_one_christmas_eve_key', () =>
              visit('2026-12-28', 'christmas-eve'),
            );
            await visit('2027-12-20', 'christmas-eve');

            const bar = (windowId: string) =>
              tx.execute(sql`insert into boss_bars
                (map_id, window_id, goal, chipped, head_start, head_start_lights, head_start_star,
                  opens_at, closes_at)
                values (${map!.id}, ${windowId}, 360, 46, 46, 3, true,
                  '2026-12-24T16:00:00Z', '2026-12-25T10:00:00Z')`);
            await bar('2026-12-21');
            await refusedBy('boss_bars_map_id_window_id_pk', () => bar('2026-12-21'));
            await refusedBy('boss_bars_window_fk', () => bar('2026-11-30'));
            const setBar = (set: ReturnType<typeof sql>) =>
              tx.execute(sql`update boss_bars set ${set}
                where map_id = ${map!.id} and window_id = '2026-12-21'`);
            await refusedBy('boss_bars_state_known', () => setBar(sql`state = 'won'`));
            await refusedBy('boss_bars_goal_positive', () => setBar(sql`goal = 0`));
            await refusedBy('boss_bars_head_start_in_chipped', () => setBar(sql`chipped = 10`));
            await refusedBy('boss_bars_head_start_lights_nonnegative', () =>
              setBar(sql`head_start_lights = -1`),
            );
            await refusedBy('boss_bars_closes_after_opens', () =>
              setBar(sql`closes_at = opens_at`),
            );
            // Falling needs a full bar and a fall time; dozing needs a short one.
            await refusedBy('boss_bars_fell_at_when_fell', () =>
              setBar(sql`state = 'fell', chipped = 400`),
            );
            await refusedBy('boss_bars_fell_when_full', () =>
              setBar(sql`state = 'fell', fell_at = now()`),
            );
            await refusedBy('boss_bars_dozed_when_short', () =>
              setBar(sql`state = 'dozed', chipped = 360`),
            );
            await setBar(sql`state = 'dozed'`);
            await setBar(sql`state = 'fell', chipped = 362, fell_at = now()`);

            // One chip per fight; the chipper is a member; points never negative.
            const battle = async () => {
              const [row] = await tx.execute<{ id: string }>(
                sql`insert into battles
                  (id, map_id, kind, status, player_user_id, seed, content_hash, setup, state)
                  values (gen_random_uuid(), ${map!.id}, 'miniboss', 'finished', ${kid!.id},
                    's', 'h', '{}'::jsonb, '{}'::jsonb)
                  returning id`,
              );
              return row!.id;
            };
            const chip = (
              battleId: string,
              userId: string,
              points: number,
              windowId = '2026-12-21',
            ) =>
              tx.execute(sql`insert into boss_bar_chips
                (id, map_id, window_id, user_id, battle_id, points, created_at)
                values (gen_random_uuid(), ${map!.id}, ${windowId}, ${userId}, ${battleId}, ${points}, now())`);
            const first = await battle();
            await chip(first, kid!.id, 0);
            await refusedBy('boss_bar_chips_battle_id_key', () => chip(first, kid!.id, 38));
            const second = await battle();
            await refusedBy('boss_bar_chips_points_nonnegative', () => chip(second, kid!.id, -1));
            await refusedBy('boss_bar_chips_member_fk', () => chip(second, stranger!.id, 5));
            await refusedBy('boss_bar_chips_bar_fk', () => chip(second, kid!.id, 5, '2026-12-14'));
            await chip(second, kid!.id, 38);
            // The chip is the bar's ledger: its battle can't go on its own.
            await refusedBy('boss_bar_chips_battle_id_battles_id_fk', () =>
              tx.execute(sql`delete from battles where id = ${second}`),
            );

            // The thanks is paid once per Keeper per visit, on their encounter.
            await tx.execute(sql`insert into boss_encounters (map_id, user_id, window_id, created_at, thanked_at)
              values (${map!.id}, ${kid!.id}, '2026-12-21', now(), now())`);

            // A visit going takes its bar and chips with it.
            await tx.execute(
              sql`delete from boss_windows where map_id = ${map!.id} and window_id = '2026-12-21'`,
            );
            const [chips] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from boss_bar_chips where map_id = ${map!.id}`,
            );
            expect(chips!.n).toBe(0);

            await tx.execute(DOWN);
            const [left] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.tables
                where table_schema = 'public' and table_name in ('boss_bars', 'boss_bar_chips')`,
            );
            expect(left!.n).toBe(0);
            const [columns] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from information_schema.columns
                where (table_name = 'boss_windows' and column_name = 'kind')
                  or (table_name = 'boss_encounters' and column_name = 'thanked_at')`,
            );
            expect(columns!.n).toBe(0);
            // The old release's weekly insert still works after the rollback.
            await visit('2027-01-04');
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await client.close();
      }
    },
  );
});
