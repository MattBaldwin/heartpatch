import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type DbClient } from './client.js';
import { migrationsFolder, runMigrations } from './migrator.js';
import { battles, buildings, mapMembers, maps, tiles, users } from './schema.js';

const url = inject('testDatabaseUrl');

interface Journal {
  entries: { idx: number; tag: string }[];
}

// #204: fences arrive in migration 0031. A patch that already has homes,
// claimed land, buildings and finished challenges moves to it with nothing
// lost and no fence invented: every old challenge reads as a guard battle.
describe.skipIf(!url)('migration 0031 on an existing patch (#204, needs DATABASE_URL)', () => {
  const name = `heartpatch_m0031_${String(process.pid)}_${String(Date.now())}`;
  let admin: DbClient;
  let client: DbClient;
  let before: string;

  beforeAll(async () => {
    admin = createDbClient(url!, { max: 1, quiet: true });
    await admin.db.execute(`create database "${name}"`);
    const dbUrl = new URL(url!);
    dbUrl.pathname = `/${name}`;
    client = createDbClient(dbUrl.href, { max: 1, quiet: true });

    // The migrations up to 0030 only: a copy of the folder with a shorter journal.
    const upTo0030 = mkdtempSync(join(tmpdir(), 'hp-m0031-'));
    try {
      cpSync(migrationsFolder, upTo0030, { recursive: true });
      const journalPath = join(upTo0030, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
      const cut = journal.entries.findIndex((e) => e.tag.startsWith('0031_'));
      expect(cut).toBeGreaterThan(0);
      journal.entries = journal.entries.slice(0, cut);
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrate(client.db, { migrationsFolder: upTo0030 });
    } finally {
      rmSync(upTo0030, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await client.close();
    await admin.db.execute(`drop database if exists "${name}" with (force)`);
    await admin.close();
  });

  /** Every pre-0031 row this test made, as JSON, for a before/after compare. */
  const snapshot = async () => {
    const rows = await client.db.execute(
      `select json_build_object(
         'tiles', (select json_agg(t order by t.id) from tiles t),
         'members', (select json_agg(m order by m.user_id) from map_members m),
         'buildings', (select json_agg(b order by b.id) from buildings b),
         'attacks', (select json_agg(json_build_object(
           'id', a.id, 'tile', a.tile_id, 'outcome', a.outcome, 'ended', a.ended_at,
           'fire', a.lost_fire_refund) order by a.id) from tile_attacks a)
       ) as s`,
    );
    return JSON.stringify((rows[0] as { s: unknown }).s);
  };

  it('keeps every home, tile, building and challenge, and adds no fences', async () => {
    const db = client.db;
    const now = new Date().toISOString();
    const user = async (username: string) =>
      (
        await db
          .insert(users)
          .values({ username, passwordHash: 'x', birthYear: 2013 })
          .returning({ id: users.id })
      )[0]!.id;
    const [maple, pip] = [await user('m0031_maple'), await user('m0031_pip')];
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Old Patch', timeZone: 'UTC' })
      .returning({ id: maps.id });
    const mapId = map!.id;
    await db.insert(mapMembers).values({ mapId, userId: maple, role: 'owner', homeSlot: 0 });
    await db.insert(mapMembers).values({ mapId, userId: pip, role: 'member', homeSlot: 1 });
    const tile = async (
      q: number,
      r: number,
      ownerUserId: string | null,
      homeSlot: number | null,
    ) =>
      (
        await db
          .insert(tiles)
          .values({ mapId, q, r, terrain: 'meadow', ownerUserId, homeSlot })
          .returning({ id: tiles.id })
      )[0]!.id;
    const home = await tile(0, 0, maple, 0);
    const claimed = await tile(1, 0, maple, null);
    await tile(2, 0, pip, null);
    await tile(3, 0, null, null);
    await db.insert(buildings).values({
      mapId,
      ownerUserId: maple,
      tileId: home,
      buildingId: 'hearthfire',
      kind: 'hearthfire',
      spot: 3,
    });
    // A finished challenge on Maple's land, from before fences.
    const [battle] = await db
      .insert(battles)
      .values({
        mapId,
        kind: 'rival-tile',
        status: 'finished',
        playerUserId: pip,
        seed: 'old',
        contentHash: 'old',
        setup: {},
        state: {},
      })
      .returning({ id: battles.id });
    // Raw SQL: the schema in code already has 0031's columns, the database not yet.
    await db.execute(sql`
      insert into tile_attacks (id, map_id, tile_id, attacker_user_id, defender_user_id, battle_id,
        outcome, started_at, cooldown_until, last_action_at, ended_at)
      values (gen_random_uuid(), ${mapId}, ${claimed}, ${pip}, ${maple}, ${battle!.id},
        'lost', ${now}, ${now}, ${now}, ${now})`);
    before = await snapshot();
    // Really before 0031: no fence table yet.
    const table = await db.execute(`select to_regclass('fence_segments') as t`);
    expect((table[0] as { t: string | null }).t).toBeNull();

    await runMigrations(db);

    expect(await snapshot()).toBe(before);
    const fences = await db.execute('select count(*)::int as n from fence_segments');
    expect((fences[0] as { n: number }).n).toBe(0);
    const old = await db.execute(
      `select part, follows_attack_id, fence_segment_id, fence_building_id,
              fence_hp_before, fence_max_hp, fence_hp_after, lost_fences
         from tile_attacks`,
    );
    expect(old).toEqual([
      {
        part: 'guard',
        follows_attack_id: null,
        fence_segment_id: null,
        fence_building_id: null,
        fence_hp_before: null,
        fence_max_hp: null,
        fence_hp_after: null,
        lost_fences: null,
      },
    ]);
  });
});
