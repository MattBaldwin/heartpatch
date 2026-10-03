import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createBattlesRepo } from '../modules/battles/repo.js';
import { createBuildingsRepo } from '../modules/buildings/repo.js';
import { removeMemberBuildings } from '../modules/buildings/service.js';
import { createMapsRepo } from '../modules/maps/repo.js';
import { createWardrobeService } from '../modules/wardrobe/service.js';
import { createDbClient, type Database, type DbClient, type Transaction } from './client.js';
import { backendPid, waitUntilBlockedBy } from '../../tests/lock-waits.js';
import {
  buildings,
  gameEvents,
  mapMembers,
  maps,
  squishies,
  tileDefenders,
  tiles,
  users,
} from './schema.js';

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
  it("locks a leaving member's tiles in id order before their defenders (maps `releaseTiles`)", async () => {
    const { mapId, userId, ids: squishyIds } = await patch();
    // Stored highest id first, like the squishies.
    const tileIds = [randomUUID(), randomUUID(), randomUUID()].sort();
    await db.insert(tiles).values(
      [...tileIds].reverse().map((id, i) => ({
        id,
        mapId,
        q: 1,
        r: i,
        terrain: 'meadow',
        ownerUserId: userId,
      })),
    );
    await db.insert(tileDefenders).values({
      mapId,
      tileId: tileIds[2]!,
      slot: 0,
      squishyId: squishyIds[0]!,
      assignedAt: new Date(),
    });

    let running: Promise<number> | undefined;
    // A capture: its tile, then the defenders posted there.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.select({ id: tiles.id }).from(tiles).where(eq(tiles.id, tileIds[0]!)).for('update');
      const pid = await backendPid(tx);
      running = unplanned((t) => createMapsRepo(t).releaseTiles(mapId, userId));
      await waitUntilBlockedBy(db, pid);
      await tx.delete(tileDefenders).where(eq(tileDefenders.tileId, tileIds[2]!));
    });
    expect(await running).toBe(3);
  });

  it("appends a new outfit's events on the player's maps in map id order (wardrobe `putOn`)", async () => {
    const username = `dresser_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    const kid = { id: user!.id, username };
    // Joined highest id first, so join order isn't id order.
    const mapIds = [randomUUID(), randomUUID(), randomUUID()].sort();
    for (const id of [...mapIds].reverse()) {
      await db
        .insert(maps)
        .values({ id, kind: 'multiplayer', name: 'Lock Patch', timeZone: 'UTC', maxPlayers: 4 });
      await db.insert(mapMembers).values({ mapId: id, userId: kid.id, role: 'owner' });
    }
    const lockMap = (tx: Transaction, id: string) =>
      tx.select({ id: maps.id }).from(maps).where(eq(maps.id, id)).for('update');

    let running: Promise<unknown> | undefined;
    // Another command appending events on the same maps: it holds the lowest
    // map's row, and once the wardrobe waits on it, takes the others in id
    // order. Out of order, the wardrobe would already hold a higher map and
    // Postgres would report a deadlock.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await lockMap(tx, mapIds[0]!);
      const pid = await backendPid(tx);
      running = createWardrobeService({ db }).wear(kid, ['sunny-cap']);
      await waitUntilBlockedBy(db, pid);
      for (const id of mapIds.slice(1)) await lockMap(tx, id);
    });
    await running;
    // The order itself is proven above (no deadlock); this checks every map was told once.
    const told = await db
      .select({ mapId: gameEvents.mapId })
      .from(gameEvents)
      .where(and(inArray(gameEvents.mapId, mapIds), eq(gameEvents.type, 'outfit.changed')))
      .orderBy(asc(gameEvents.mapId));
    expect(told.map((e) => e.mapId)).toEqual(mapIds);
  });
});
