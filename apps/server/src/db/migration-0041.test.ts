import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { ICU_LINK_TO_ZONE } from '../lib/time.js';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { maps, users } from './schema.js';

const url = inject('testDatabaseUrl');

// Migration 0041 rewrites ICU legacy link names stored before #367 to the
// zone each links to. Its list is copied into the SQL by hand; this ties it
// to ICU_LINK_TO_ZONE, then runs it on seeded rows.
const migrationSql = readFileSync(join(migrationsFolder, '0041_legacy_time_zones.sql'), 'utf8');
const statements = migrationSql
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe('migration 0041 on legacy time-zone names', () => {
  it('rewrites exactly ICU_LINK_TO_ZONE, in maps and users', () => {
    const tables = statements.map((s) => /^(?:--.*\n)*UPDATE "(\w+)"/.exec(s)?.[1]);
    expect(tables).toEqual(['maps', 'users']);
    for (const statement of statements) {
      const pairs = [...statement.matchAll(/\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]);
      expect(Object.fromEntries(pairs)).toEqual(ICU_LINK_TO_ZONE);
      expect(pairs).toHaveLength(Object.keys(ICU_LINK_TO_ZONE).length);
    }
  });

  it.skipIf(!url)(
    'leaves every stored zone one Postgres accepts (needs DATABASE_URL)',
    async () => {
      const client = createDbClient(url!, { max: 1, quiet: true });
      try {
        const { db } = client;
        const links = Object.keys(ICU_LINK_TO_ZONE);
        const tag = `${String(process.pid)}_${String(Date.now())}`;
        // A canonical zone alongside the legacy ones stays as it is.
        const zones = [...links, 'America/Chicago'];
        const mapIds = (
          await db
            .insert(maps)
            .values(
              zones.map((timeZone) => ({ kind: 'tutorial' as const, name: 'm0041', timeZone })),
            )
            .returning({ id: maps.id })
        ).map((r) => r.id);
        const userIds = (
          await db
            .insert(users)
            .values(
              zones.map((timeZone, i) => ({
                username: `m0041_${tag}_${String(i)}`,
                passwordHash: 'x',
                birthYear: 2013,
                timeZone,
              })),
            )
            .returning({ id: users.id })
        ).map((r) => r.id);

        // Twice: a second run changes nothing.
        for (let run = 0; run < 2; run++) {
          for (const statement of statements) await db.execute(sql.raw(statement));
        }

        const expected = zones.map((zone) => ICU_LINK_TO_ZONE[zone] ?? zone);
        const mapRows = await db
          .select({ id: maps.id, timeZone: maps.timeZone })
          .from(maps)
          .where(inArray(maps.id, mapIds));
        const userRows = await db
          .select({ id: users.id, timeZone: users.timeZone })
          .from(users)
          .where(inArray(users.id, userIds));
        const byId = (rows: { id: string; timeZone: string }[], ids: string[]) =>
          ids.map((id) => rows.find((r) => r.id === id)?.timeZone);
        expect(byId(mapRows, mapIds)).toEqual(expected);
        expect(byId(userRows, userIds)).toEqual(expected);

        const rejected: string[] = [];
        for (const zone of new Set(expected)) {
          try {
            await db.execute(sql`select now() at time zone ${zone}`);
          } catch {
            rejected.push(zone);
          }
        }
        expect(rejected).toEqual([]);
        // Straight from the rows, as the services query them.
        await db.execute(
          sql`select now() at time zone ${maps.timeZone} from ${maps} where ${inArray(maps.id, mapIds)}`,
        );
        await db.execute(
          sql`select now() at time zone ${users.timeZone} from ${users} where ${inArray(users.id, userIds)}`,
        );

        await db.delete(maps).where(inArray(maps.id, mapIds));
        await db.delete(users).where(inArray(users.id, userIds));
      } finally {
        await client.close();
      }
    },
  );
});
