import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createBattlesRepo } from '../modules/battles/repo.js';
import { createBuildingsRepo } from '../modules/buildings/repo.js';
import { removeMemberBuildings } from '../modules/buildings/service.js';
import { createDbClient, type Database, type DbClient, type Transaction } from './client.js';
import { backendPid, waitUntilBlockedBy } from '../../tests/lock-waits.js';
import { buildings, mapMembers, maps, squishies, tiles, users } from './schema.js';

const url = inject('testDatabaseUrl');

/*
 * Tech spec §7 "Lock order": squishies are locked in id order everywhere, like
 * nightfall's `nightSquishies`. Each test holds the lowest squishy the way
 * nightfall would, starts the command under test, and once it waits takes
 * the next squishy too. In id order the command holds nothing yet, so both
 * finish; out of order it would hold the higher one and Postgres would report
 * a deadlock.
 */
describe.skipIf(!url)('squishy lock order (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10, quiet: true });
    db = client.db;
  });
  afterAll(() => client.close());

  async function patch() {
    const [user] = await db
      .insert(users)
      .values({
        username: `locker_${String(process.pid)}_${String((counter += 1))}`,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
      })
      .returning({ id: users.id });
    const [map] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Lock Hollow', timeZone: 'UTC', maxPlayers: 1 })
      .returning({ id: maps.id });
    const mapId = map!.id;
    const userId = user!.id;
    await db.insert(mapMembers).values({ mapId, userId, role: 'owner' });
    const [tile] = await db
      .insert(tiles)
      .values({ mapId, q: 0, r: 0, terrain: 'meadow' })
      .returning({ id: tiles.id });
    const [building] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: userId,
        tileId: tile!.id,
        buildingId: 'test-habitat',
        kind: 'habitat',
        spot: 1,
      })
      .returning({ id: buildings.id });
    // Postgres orders uuids bytewise, which is lowercase hex order. Stored
    // highest id first, so a scan in storage order meets them out of id order.
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    await db.insert(squishies).values(
      [...ids].reverse().map((id) => ({
        id,
        mapId,
        ownerUserId: userId,
        speciesId: 'test-squishy',
        element: 'fire',
        feeling: 'cozy',
        habitatBuildingId: building!.id,
      })),
    );
    return { mapId, userId, buildingId: building!.id, ids };
  }

  const lockSquishy = (tx: Transaction, id: string) =>
    tx.select({ id: squishies.id }).from(squishies).where(eq(squishies.id, id)).for('update');

  /**
   * A transaction whose plans scan in storage order. Without an ORDER BY,
   * lock order is whatever the plan gives, and plans change with table size.
   */
  const unplanned = <T>(fn: (tx: Transaction) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
      return fn(tx);
    });

  /** Holds the lowest squishy, runs `command`, then takes the others in id order. */
  async function nightfallAgainst(ids: string[], command: () => Promise<unknown>): Promise<void> {
    let running: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      // Fails fast instead of hanging if the order is ever wrong again.
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await lockSquishy(tx, ids[0]!);
      const pid = await backendPid(tx);
      running = command();
      await waitUntilBlockedBy(db, pid);
      for (const id of ids.slice(1)) await lockSquishy(tx, id);
    });
    await running;
  }

  it("locks a battle's squishies in id order (battles `lockSquishies`)", async () => {
    const { ids } = await patch();
    await nightfallAgainst(ids, () =>
      unplanned((tx) => createBattlesRepo(tx).lockSquishies([...ids].reverse())),
    );
  });

  it("locks a habitat's residents in id order before moving them out (buildings `moveOutAll`)", async () => {
    const { buildingId, ids } = await patch();
    let moved: string[] = [];
    await nightfallAgainst(ids, async () => {
      moved = await unplanned((tx) => createBuildingsRepo(tx).moveOutAll(buildingId));
    });
    expect(moved).toEqual(ids);
    const left = await db
      .select({ id: squishies.id })
      .from(squishies)
      .where(eq(squishies.habitatBuildingId, buildingId))
      .orderBy(asc(squishies.id));
    expect(left).toEqual([]);
  });
  it("locks a leaving member's habitat residents in id order (buildings `removeMemberBuildings`)", async () => {
    const { mapId, userId, buildingId, ids } = await patch();
    await nightfallAgainst(ids, () => unplanned((tx) => removeMemberBuildings(tx, mapId, userId)));
    const gone = await db
      .select({ id: buildings.id })
      .from(buildings)
      .where(eq(buildings.id, buildingId));
    expect(gone).toEqual([]);
    const homeless = await db
      .select({ id: squishies.id })
      .from(squishies)
      .where(eq(squishies.mapId, mapId))
      .orderBy(asc(squishies.id));
    expect(homeless.map((r) => r.id)).toEqual(ids);
  });
});
