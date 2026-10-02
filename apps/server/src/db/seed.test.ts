import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from './client.js';
import { mapMembers, maps, tiles, users } from './schema.js';
import { SEED_PASSWORD_HASH, SEED_USERNAMES, seed } from './seed.js';

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('seed (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;

  beforeAll(() => {
    client = createDbClient(url!, { max: 2 });
    db = client.db;
  });
  afterAll(() => client.close());

  it('creates a test map with 2 users, then does nothing on re-run', async () => {
    const first = await seed(db);
    expect(first.created).toBe(true);
    expect(first.userIds).toHaveLength(2);

    const [map] = await db.select().from(maps).where(eq(maps.id, first.mapId));
    expect(map).toMatchObject({ kind: 'multiplayer', eventSeq: 0 });

    const members = await db
      .select({ role: mapMembers.role, username: users.username, hash: users.passwordHash })
      .from(mapMembers)
      .innerJoin(users, eq(users.id, mapMembers.userId))
      .where(eq(mapMembers.mapId, first.mapId));
    expect(members.map((m) => m.username).sort()).toEqual([...SEED_USERNAMES].sort());
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(members.every((m) => m.hash === SEED_PASSWORD_HASH)).toBe(true);

    const seededTiles = await db.select().from(tiles).where(eq(tiles.mapId, first.mapId));
    expect(seededTiles).toHaveLength(19); // hex radius 2
    expect(
      seededTiles.every(
        (t) => Math.abs(t.q) <= 2 && Math.abs(t.r) <= 2 && Math.abs(t.q + t.r) <= 2,
      ),
    ).toBe(true);

    const again = await seed(db);
    expect(again).toEqual({
      ...first,
      created: false,
      userIds: expect.arrayContaining(first.userIds) as unknown,
    });
    expect(await db.select().from(maps).where(eq(maps.name, map!.name))).toHaveLength(1);
  });
});
