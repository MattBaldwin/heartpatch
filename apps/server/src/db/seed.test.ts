import { GAME_DATA, generateMap, MAP_MAX_PLAYERS } from '@heartpatch/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from './client.js';
import { mapMembers, maps, tiles, users } from './schema.js';
import { SEED_MAP_SEED, SEED_PASSWORD_HASH, SEED_USERNAMES, seed } from './seed.js';

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

    expect(map?.seed).toBe(SEED_MAP_SEED);
    expect(map?.maxPlayers).toBe(MAP_MAX_PLAYERS);

    // Stored exactly as generateMap made it, with each member holding their home base.
    const generated = generateMap(GAME_DATA, { seed: SEED_MAP_SEED, playerCount: MAP_MAX_PLAYERS });
    const seededTiles = await db.select().from(tiles).where(eq(tiles.mapId, first.mapId));
    expect(seededTiles).toHaveLength(generated.tiles.length);
    const stored = new Map(seededTiles.map((t) => [`${t.q},${t.r}`, t]));
    for (const t of generated.tiles) {
      expect(stored.get(`${t.q},${t.r}`)).toMatchObject({
        terrain: t.terrain,
        nodeResource: t.nodeResource,
        guardianStrength: t.guardianStrength,
        homeSlot: t.homeSlot,
        ownerUserId: t.homeSlot === null ? null : (first.userIds[t.homeSlot] ?? null),
      });
    }
    const slots = await db
      .select({ userId: mapMembers.userId, homeSlot: mapMembers.homeSlot })
      .from(mapMembers)
      .where(eq(mapMembers.mapId, first.mapId));
    expect(slots).toEqual(
      expect.arrayContaining(first.userIds.map((userId, i) => ({ userId, homeSlot: i }))),
    );

    const again = await seed(db);
    // Same ids in the same order (owner first) as when it was created.
    expect(again).toEqual({ ...first, created: false });
    expect(await db.select().from(maps).where(eq(maps.name, map!.name))).toHaveLength(1);
  });
});
