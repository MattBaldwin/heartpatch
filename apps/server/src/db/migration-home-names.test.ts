import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DATA, HOME_BASE_RULES } from '@heartpatch/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { databaseBefore } from '../../tests/before-migration.js';
import { migrationsFolder, runMigrations } from './migrator.js';

const url = inject('testDatabaseUrl');

// Migration 0050 (#306) adds the home name and naming counters to
// `map_members`, starts the `home-naming` consumer at each patch's head, and
// back-fills the counters from the events up to there (plus what stands
// now). These check the back-fill's building list against today's data and
// run it on seeded rows.
const file = readdirSync(migrationsFolder).find((f) => f.endsWith('_home_names.sql'));
const tag = (file ?? 'missing.sql').replace(/\.sql$/, '');
const migrationSql = readFileSync(join(migrationsFolder, file ?? 'missing.sql'), 'utf8');

const BUILDABLE = new Set<string>(HOME_BASE_RULES.buildableKinds);

describe('migration 0050 home names (#306)', () => {
  it("maps every buildable building id to its kind, as today's data does", () => {
    const cases = Object.fromEntries(
      [...migrationSql.matchAll(/WHEN '([a-z0-9-]+)' THEN '([a-z-]+)'/g)].map((m) => [m[1], m[2]]),
    );
    const expected = Object.fromEntries(
      GAME_DATA.buildings.filter((b) => BUILDABLE.has(b.kind)).map((b) => [b.id, b.kind]),
    );
    expect(cases).toEqual(expected);
    const standing = /"b"\."kind" IN \(([^)]*)\)/.exec(migrationSql)?.[1] ?? '';
    expect(
      standing
        .split(',')
        .map((k) => k.trim().replace(/'/g, ''))
        .sort(),
    ).toEqual([...BUILDABLE].sort());
  });

  it('starts the consumer before it back-fills', () => {
    const insert = migrationSql.indexOf('INSERT INTO "event_consumers"');
    expect(insert).toBeGreaterThan(0);
    expect(insert).toBeLessThan(migrationSql.indexOf('SET "caught_count"'));
  });

  it.skipIf(!url)('back-fills patches from their events and buildings (needs DATABASE_URL)', async () => {
    const scratch = await databaseBefore(url!, tag);
    const { db } = scratch.client;
    try {
      const one = async <T>(query: ReturnType<typeof sql>) =>
        ((await db.execute(query)) as unknown as T[])[0]!;
      const uid = async (name: string) =>
        (
          await one<{ id: string }>(sql`
            insert into users (id, username, password_hash, birth_year)
            values (gen_random_uuid(), ${name}, 'x', 2013) returning id`)
        ).id;
      const mapOf = async (kind: string) =>
        (
          await one<{ id: string }>(sql`
            insert into maps (id, kind, name, time_zone)
            values (gen_random_uuid(), ${kind}::map_kind, 'm0050', 'UTC') returning id`)
        ).id;
      const kid = await uid('m0050_kid');
      const pal = await uid('m0050_pal');
      const patch = await mapOf('multiplayer');
      const glade = await mapOf('tutorial');
      await db.execute(sql`
        insert into map_members (map_id, user_id, role) values
          (${patch}, ${kid}, 'owner'), (${patch}, ${pal}, 'member'), (${glade}, ${kid}, 'owner')`);
      const tile = (
        await one<{ id: string }>(sql`
          insert into tiles (id, map_id, q, r, terrain)
          values (gen_random_uuid(), ${patch}, 0, 0, 'meadow') returning id`)
      ).id;

      let seq = 0;
      const event = async (mapId: string, type: string, payload: object) => {
        seq += 1;
        await db.execute(sql`
          insert into game_events (id, map_id, seq, type, payload)
          values (gen_random_uuid(), ${mapId}, ${seq}, ${type}, ${JSON.stringify(payload)}::jsonb)`);
      };
      const placedBy = (userId: string, buildingId: string) => ({
        userId,
        building: { buildingId },
      });
      await event(patch, 'squishy.captured', { userId: kid });
      await event(patch, 'squishy.captured', { userId: kid });
      await event(patch, 'squishy.captured', { userId: pal });
      await event(patch, 'squishy.captured', { userId: kid });
      await event(patch, 'building.placed', placedBy(kid, 'cozy-meadow'));
      await event(patch, 'building.placed', placedBy(kid, 'ember-den'));
      await event(patch, 'building.placed', placedBy(kid, 'crafting-factory'));
      await event(patch, 'building.placed', placedBy(kid, 'not-a-building'));
      await event(patch, 'fence.built', { userId: pal });
      await db.execute(sql`update maps set event_seq = ${seq} where id = ${patch}`);
      const head = seq;
      seq = 0;
      await event(glade, 'squishy.captured', { userId: kid });
      await event(glade, 'building.placed', placedBy(kid, 'training-grounds'));
      await db.execute(sql`update maps set event_seq = ${seq} where id = ${glade}`);
      // Standing now, their events long gone to retention.
      await db.execute(sql`
        insert into buildings (id, map_id, owner_user_id, tile_id, building_id, kind, spot)
        values (gen_random_uuid(), ${patch}, ${pal}, ${tile}, 'training-grounds', 'training-grounds', 1)`);
      await db.execute(sql`
        insert into fence_segments (id, map_id, owner_user_id, tile_id, edge, building_id, hp)
        values (gen_random_uuid(), ${patch}, ${kid}, ${tile}, 0, 'hedge', 5)`);

      await runMigrations(db);

      const rows = (await db.execute(sql`
        select map_id, user_id, caught_count, kinds_built, home_name, home_named_at_level
        from map_members where map_id in (${patch}, ${glade})`)) as unknown as {
        map_id: string;
        user_id: string;
        caught_count: number;
        kinds_built: string[];
        home_name: string | null;
        home_named_at_level: number | null;
      }[];
      const row = (mapId: string, userId: string) =>
        rows.find((r) => r.map_id === mapId && r.user_id === userId);
      expect(row(patch, kid)).toMatchObject({
        caught_count: 3,
        kinds_built: ['factory', 'fence', 'habitat'],
        home_name: null,
        home_named_at_level: null,
      });
      expect(row(patch, pal)).toMatchObject({
        caught_count: 1,
        kinds_built: ['fence', 'training-grounds'],
      });
      expect(row(glade, kid)).toMatchObject({ caught_count: 0, kinds_built: [] });

      const positions = (await db.execute(sql`
        select map_id, last_seq from event_consumers where consumer = 'home-naming'`)) as unknown as {
        map_id: string;
        last_seq: number | string;
      }[];
      expect(positions.map((p) => [p.map_id, Number(p.last_seq)])).toEqual([[patch, head]]);
    } finally {
      await scratch.drop();
    }
  });
});
