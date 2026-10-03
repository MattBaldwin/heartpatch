import { isOnWatch } from '@heartpatch/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createBuildingsRepo } from '../modules/buildings/repo.js';
import { createCareRepo } from '../modules/care/repo.js';
import { createMapsRepo } from '../modules/maps/repo.js';
import { squishyOnWatch } from '../modules/territory/repo.js';
import { createDbClient, type Database, type DbClient } from './client.js';
import { mapMembers, maps, squishies, tileDefenders, tiles, users } from './schema.js';

const url = inject('testDatabaseUrl');

/*
 * Territory's `squishyOnWatch` is the one SQL spelling of "on watch". Housing, care and
 * the map view's guard count all read it, so they agree with each other and
 * with shared `isOnWatch` on every kind of post.
 */
describe.skipIf(!url)('squishyOnWatch (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 4, quiet: true });
    db = client.db;
  });
  afterAll(() => client.close());

  async function player() {
    const [user] = await db
      .insert(users)
      .values({
        username: `watcher_${String(process.pid)}_${String((counter += 1))}`,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
      })
      .returning({ id: users.id });
    return user!.id;
  }

  it('counts a post on land its owner still holds, and nothing else', async () => {
    const kid = await player();
    const neighbour = await player();
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Watch Patch', timeZone: 'UTC', maxPlayers: 4 })
      .returning({ id: maps.id });
    const mapId = map!.id;
    await db.insert(mapMembers).values([
      { mapId, userId: kid, role: 'owner' },
      { mapId, userId: neighbour, role: 'member' },
    ]);
    const [mine, theirs, nobodys] = await db
      .insert(tiles)
      .values([
        { mapId, q: 0, r: 0, terrain: 'meadow', ownerUserId: kid },
        // Land that changed hands, and land let go, with the kid's posts still on it.
        { mapId, q: 1, r: 0, terrain: 'meadow', ownerUserId: neighbour },
        { mapId, q: 2, r: 0, terrain: 'meadow' },
      ])
      .returning({ id: tiles.id });
    const squishy = async () => {
      const [row] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: kid,
          speciesId: 'emberbun',
          element: 'fire',
          feeling: 'cozy',
        })
        .returning({ id: squishies.id });
      return row!.id;
    };
    const guarding = await squishy();
    const strayed = await squishy();
    const unclaimed = await squishy();
    const resting = await squishy();
    await db.insert(tileDefenders).values([
      { mapId, tileId: mine!.id, slot: 0, squishyId: guarding, assignedAt: new Date() },
      { mapId, tileId: theirs!.id, slot: 0, squishyId: strayed, assignedAt: new Date() },
      { mapId, tileId: nobodys!.id, slot: 0, squishyId: unclaimed, assignedAt: new Date() },
    ]);
    const expected = new Map([
      [guarding, true],
      [strayed, false],
      [unclaimed, false],
      [resting, false],
    ]);

    // Shared `isOnWatch` on the same posts (all active).
    const owners = new Map([
      [guarding, kid],
      [strayed, neighbour],
      [unclaimed, null],
    ]);
    for (const [id, onWatch] of expected) {
      const tileOwnerUserId = owners.get(id);
      const post = tileOwnerUserId === undefined ? null : { tileOwnerUserId };
      expect(isOnWatch({ ownerUserId: kid, state: 'active' }, post)).toBe(onWatch);
    }

    // On its own, in a one-table select (which names columns without the table).
    const rows = await db
      .select({ id: squishies.id, onWatch: squishyOnWatch() })
      .from(squishies)
      .where(eq(squishies.mapId, mapId));
    expect(new Map(rows.map((r) => [r.id, r.onWatch]))).toEqual(expected);

    // Housing's check and care's column.
    const buildings = createBuildingsRepo(db);
    for (const [id, onWatch] of expected) expect(await buildings.isOnWatch(id)).toBe(onWatch);
    const care = await createCareRepo(db).listActive(mapId, kid);
    expect(new Map(care.map((s) => [s.id, s.onWatch]))).toEqual(expected);

    // The map view's guard count, inside a query over `tiles`: only the kid's own tile has one.
    const view = await createMapsRepo(db).listTiles(mapId);
    expect(view.map((t) => [t.q, t.defenders])).toEqual([
      [0, 1],
      [1, 0],
      [2, 0],
    ]);
  });
});
