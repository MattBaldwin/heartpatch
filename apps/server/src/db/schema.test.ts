import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from './client.js';
import { runMigrations } from './migrator.js';
import { mapMembers, maps, squishies, tiles, users } from './schema.js';

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('schema constraints (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let n = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 2, quiet: true });
    db = client.db;
  });
  afterAll(() => client.close());

  async function newUser(username = `schema_user_${String(++n)}`): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'x', birthYear: 2013 })
      .returning({ id: users.id });
    return user!.id;
  }

  async function newMap(): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC' })
      .returning({ id: maps.id });
    return map!.id;
  }

  it('re-running migrations is a no-op', async () => {
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });

  it('generates uuid v7 ids and UTC timestamps', async () => {
    const id = await newUser();
    const [user] = await db.select().from(users).where(eq(users.id, id));
    expect(user!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(user!.createdAt).toBeInstanceOf(Date);
    expect(user!.tutorialStep).toBeNull();
  });

  it('treats usernames case-insensitively', async () => {
    await newUser('GhostToast');
    await expect(newUser('ghosttoast')).rejects.toThrow();
  });

  it('allows one owner per map', async () => {
    const mapId = await newMap();
    const [a, b] = [await newUser(), await newUser()];
    await db.insert(mapMembers).values({ mapId, userId: a, role: 'owner' });
    await expect(
      db.insert(mapMembers).values({ mapId, userId: b, role: 'owner' }),
    ).rejects.toThrow();
    await db.insert(mapMembers).values({ mapId, userId: b, role: 'member' });
  });

  it('only lets members of the same map own its tiles and squishies', async () => {
    const [mapId, otherMap] = [await newMap(), await newMap()];
    const member = await newUser();
    const outsider = await newUser();
    await db.insert(mapMembers).values({ mapId, userId: member, role: 'owner' });
    await db.insert(mapMembers).values({ mapId: otherMap, userId: outsider, role: 'owner' });

    await db.insert(tiles).values({ mapId, q: 0, r: 0, terrain: 'meadow', ownerUserId: member });
    await db.insert(tiles).values({ mapId, q: 1, r: 0, terrain: 'meadow', ownerUserId: null });
    await expect(
      db.insert(tiles).values({ mapId, q: 0, r: 1, terrain: 'meadow', ownerUserId: outsider }),
    ).rejects.toThrow();

    const squishy = { speciesId: 'test', element: 'leaf', feeling: 'cozy' };
    await db.insert(squishies).values({ mapId, ownerUserId: member, ...squishy });
    await expect(
      db.insert(squishies).values({ mapId, ownerUserId: outsider, ...squishy }),
    ).rejects.toThrow();
  });

  it('keeps one tile per hex', async () => {
    const mapId = await newMap();
    await db.insert(tiles).values({ mapId, q: 2, r: -1, terrain: 'forest' });
    await expect(
      db.insert(tiles).values({ mapId, q: 2, r: -1, terrain: 'hills' }),
    ).rejects.toThrow();
  });

  it('removes a map’s rows with the map', async () => {
    const mapId = await newMap();
    const owner = await newUser();
    await db.insert(mapMembers).values({ mapId, userId: owner, role: 'owner' });
    await db.insert(tiles).values({ mapId, q: 0, r: 0, terrain: 'meadow', ownerUserId: owner });
    await db.delete(maps).where(eq(maps.id, mapId));
    expect(await db.select().from(tiles).where(eq(tiles.mapId, mapId))).toEqual([]);
    expect(await db.select().from(mapMembers).where(eq(mapMembers.mapId, mapId))).toEqual([]);
  });
});
