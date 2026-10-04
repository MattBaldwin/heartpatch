import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  applyBattleAction,
  hexKey,
  hexNeighbors,
  STARTERS,
  type BattleAction,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import { createBattlesRepo } from '../modules/battles/repo.js';
import { createBattlesService, defaultBattleContent } from '../modules/battles/service.js';
import { createBuildingsRepo } from '../modules/buildings/repo.js';
import { createBuildingsService, removeMemberBuildings } from '../modules/buildings/service.js';
import { createCareService } from '../modules/care/service.js';
import { createCoinsRepo } from '../modules/coins/repo.js';
import { grantItems } from '../modules/inventory/service.js';
import { createMapsRepo } from '../modules/maps/repo.js';
import { createMilestonesConsumer } from '../modules/milestones/consumer.js';
import { createMilestonesService, milestoneRewardId } from '../modules/milestones/service.js';
import { createMapsService } from '../modules/maps/service.js';
import { createStartersService } from '../modules/starters/service.js';
import { createTerritoryService, createTileBattlePort } from '../modules/territory/service.js';
import { setDevDropChance } from '../modules/wardrobe/drops.js';
import { createWardrobeService } from '../modules/wardrobe/service.js';
import { AppError } from '../lib/errors.js';
import { createJobsRepo } from '../jobs/repo.js';
import { runConsumer } from '../jobs/consumers.js';
import { appendGameEvent } from './game-events.js';
import {
  createDbClient,
  withTransaction,
  type Database,
  type DbClient,
  type Transaction,
} from './client.js';
import { backendPid, waitUntilBlockedBy } from '../../tests/lock-waits.js';
import {
  buildings,
  clothingOwned,
  coinLedger,
  gameEvents,
  inventories,
  mapMembers,
  maps,
  milestoneProgress,
  milestoneRewards,
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

  /** A new player (`users` row) for these tests. */
  async function player(prefix: string) {
    const username = `${prefix}_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    return { id: user!.id, username };
  }

  /** What a command came to: 'ok', or what it threw. Never rejects, so nothing goes unhandled. */
  const outcome = (command: Promise<unknown>) =>
    command.then(
      () => 'ok' as const,
      (err: unknown) => err,
    );

  const code = (err: unknown) => (err instanceof AppError ? err.code : err);

  it('posts a guard and houses the same squishy one at a time; exactly one wins (territory `lockSquishies`, buildings `house`)', async () => {
    const kid = await player('guard');
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Lock Patch', timeZone: 'UTC', maxPlayers: 4 })
      .returning({ id: maps.id });
    const mapId = map!.id;
    await db.insert(mapMembers).values({ mapId, userId: kid.id, role: 'owner' });
    const [home, post] = await db
      .insert(tiles)
      .values([
        { mapId, q: 0, r: 0, terrain: 'meadow', ownerUserId: kid.id, homeSlot: 0 },
        { mapId, q: 1, r: 0, terrain: 'meadow', ownerUserId: kid.id },
      ])
      .returning({ id: tiles.id });
    const [den] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: home!.id,
        buildingId: 'ember-den',
        kind: 'habitat',
        spot: 1,
      })
      .returning({ id: buildings.id });
    const [squishy] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: kid.id,
        speciesId: 'emberbun',
        element: 'fire',
        feeling: 'cozy',
      })
      .returning({ id: squishies.id });
    const squishyId = squishy!.id;

    let posting: Promise<unknown> | undefined;
    let housing: Promise<unknown> | undefined;
    // Nightfall-style: hold the squishy, let both commands queue on it, then
    // let go. Posting holds the member row and its tile while it waits;
    // housing holds the player's home tiles and the den. Both take the squishy
    // before `maps`, so whichever gets it first finishes and the other then
    // sees what it did. Housing taking `maps` before the squishy would
    // deadlock here (40P01).
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await lockSquishy(tx, squishyId);
      const pid = await backendPid(tx);
      posting = outcome(
        createTerritoryService({
          db,
          // Posting guards starts no battle.
          battles: { startTile: () => Promise.reject(new Error('no battles here')) },
        }).setDefenders(kid, mapId, {
          q: 1,
          r: 0,
          squishyIds: [squishyId],
        }),
      );
      await waitUntilBlockedBy(db, pid);
      housing = outcome(createBuildingsService({ db }).house(kid, mapId, squishyId, den!.id));
      await waitUntilBlockedBy(db, pid, 2);
    });
    const results = await Promise.all([posting!, housing!]);
    // One wins; the other is refused as housed or on watch, not deadlocked.
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r !== 'ok').map(code)).toEqual(['CONFLICT']);

    const [row] = await db
      .select({ habitat: squishies.habitatBuildingId })
      .from(squishies)
      .where(eq(squishies.id, squishyId));
    const posts = await db
      .select({ tileId: tileDefenders.tileId })
      .from(tileDefenders)
      .where(eq(tileDefenders.squishyId, squishyId));
    // Housed or on watch, not both.
    if (results[0] === 'ok') {
      expect(posts).toEqual([{ tileId: post!.id }]);
      expect(row?.habitat).toBeNull();
    } else {
      expect(posts).toEqual([]);
      expect(row?.habitat).toBe(den!.id);
    }
  });

  /**
   * A tile battle one move from the player winning it (and the tile): the
   * player's level-40 hero against a neutral tile's guardians, played up to
   * the turn before the end, checked against the stored state (the engine is
   * deterministic). `finishing` is the move that wins.
   */
  async function oneMoveFromWinning(prefix: string) {
    const kid = await player(prefix);
    const map = await createMapsService({
      db,
      tutorialRequired: false,
      keeperRequired: false,
    }).create(kid, { name: 'Lock Patch', timeZone: 'UTC' });
    const mapId = map.id;
    const [hero] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: kid.id,
        speciesId: STARTERS.speciesIds[0]!,
        element: 'fire',
        feeling: 'cozy',
        level: 40,
      })
      .returning({ id: squishies.id });
    const heroId = hero!.id;
    const all = await db.select().from(tiles).where(eq(tiles.mapId, mapId));
    const mine = new Set(all.filter((t) => t.ownerUserId === kid.id).map(hexKey));
    const target = all.find(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexNeighbors(t).some((n) => mine.has(hexKey(n))),
    )!;

    const content = defaultBattleContent();
    const fights = createBattlesService({ db, content, tileBattles: createTileBattlePort() });
    const territory = createTerritoryService({ db, battles: fights });
    const { battle } = await territory.attack(kid, mapId, { q: target.q, r: target.r });
    // Plays the first move every turn up to the one that wins the tile,
    // checked against the stored state (the engine is deterministic).
    let finishing: { action: PlayerBattleAction; turn: number } | null = null;
    for (let i = 0; i < content.rules.maxTurns + 5 && !finishing; i++) {
      const { state } = (await createBattlesRepo(db).findBattle(battle.id))!;
      const side = state.sides.a;
      let action: PlayerBattleAction;
      let engine: BattleAction;
      if (state.phase.type === 'replace') {
        const slot = side.squishies.findIndex((s) => s.energy > 0);
        action = { type: 'replace', slot };
        engine = { type: 'replace', side: 'a', slot };
      } else {
        const move = side.squishies[side.active]!.moves[0]!;
        action = { type: 'move', move };
        engine = { type: 'turn', choices: { a: { type: 'move', move } } };
      }
      const next = applyBattleAction(content, state, engine);
      if (next.phase.type === 'over') {
        expect(next.phase.result.winner).toBe('a');
        finishing = { action, turn: state.turn };
      } else {
        await fights.act(kid, battle.id, { action, turn: state.turn });
      }
    }
    expect(finishing).not.toBeNull();
    return { kid, mapId, heroId, target, battle, fights, finishing: finishing! };
  }

  it("rolls a capture's found clothing after the battle's squishy locks (battles `finish`, #84)", async () => {
    const { kid, mapId, heroId, target, battle, fights, finishing } =
      await oneMoveFromWinning('capturer');

    setDevDropChance(100);
    let running: Promise<unknown> | undefined;
    try {
      // Nightfall-style: hold the hero, let the winning move queue on it,
      // then append an event (the `maps` row). The finish holds the battle
      // and the tile while it waits, but not `maps`: its find is rolled
      // after the squishy locks. Rolled in the territory port (before them),
      // the finish would hold `maps` here and Postgres would report a
      // deadlock (40P01).
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await lockSquishy(tx, heroId);
        const pid = await backendPid(tx);
        running = fights.act(kid, battle.id, finishing);
        await waitUntilBlockedBy(db, pid);
        await tx.select({ id: maps.id }).from(maps).where(eq(maps.id, mapId)).for('update');
      });
      await running;
    } finally {
      setDevDropChance(null);
    }

    const [tile] = await db.select().from(tiles).where(eq(tiles.id, target.id));
    expect(tile!.ownerUserId).toBe(kid.id);
    const pieces = await db
      .select({ source: clothingOwned.source, refId: clothingOwned.refId })
      .from(clothingOwned)
      .where(eq(clothingOwned.userId, kid.id));
    expect(pieces).toEqual([{ source: 'capture', refId: battle.id }]);
  });

  /*
   * Patch Coins (#45): the account's `coin_balances` row comes after
   * squishies, inventory and `species_seen`, and before `maps` (tech spec §7
   * step 12). Each test holds a lock from one side of it, lets the command
   * queue there, then takes a lock from the other side. Taken on the wrong
   * side, the command would hold what the test then asks for, and Postgres
   * would report a deadlock (40P01) or the lock timeout would fail it.
   */
  const lockCoins = (tx: Transaction, userId: string) => createCoinsRepo(tx).lockBalance(userId);
  /** What `appendGameEvent`'s `event_seq` bump takes on the `maps` row. */
  const lockMapRow = (tx: Transaction, mapId: string) =>
    tx.select({ id: maps.id }).from(maps).where(eq(maps.id, mapId)).for('no key update');

  /** Holds `first`, runs `command`, and once it waits, takes `then` too. */
  async function holdThen(
    first: (tx: Transaction) => Promise<unknown>,
    command: () => Promise<unknown>,
    then: (tx: Transaction) => Promise<unknown>,
  ): Promise<void> {
    let running: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await first(tx);
      const pid = await backendPid(tx);
      running = command();
      await waitUntilBlockedBy(db, pid);
      await then(tx);
    });
    await running;
  }

  /** A patch with one squishy and some Treats, for care. */
  async function careSetup(prefix: string) {
    const kid = await player(prefix);
    const map = await createMapsService({
      db,
      tutorialRequired: false,
      keeperRequired: false,
    }).create(kid, { name: 'Lock Patch', timeZone: 'UTC' });
    const [pet] = await db
      .insert(squishies)
      .values({
        mapId: map.id,
        ownerUserId: kid.id,
        speciesId: STARTERS.speciesIds[0]!,
        element: 'fire',
        feeling: 'cozy',
      })
      .returning({ id: squishies.id });
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId: map.id, userId: kid.id }, { treats: 1 }, 'dev-grant'),
    );
    return { kid, mapId: map.id, petId: pet!.id, care: createCareService({ db }) };
  }

  const coinRows = (userId: string) =>
    db
      .select({ source: coinLedger.source, amount: coinLedger.amount })
      .from(coinLedger)
      .where(eq(coinLedger.userId, userId));

  it('pays care coins after the inventory rows (care `care`, #45)', async () => {
    const { kid, mapId, petId, care } = await careSetup('feeder');
    // Hold the Treats row (another command spending Treats), let a feed queue
    // on it, then take the coins: the feed must not hold them yet.
    await holdThen(
      (tx) =>
        tx
          .select({ itemId: inventories.itemId })
          .from(inventories)
          .where(and(eq(inventories.mapId, mapId), eq(inventories.userId, kid.id)))
          .for('update'),
      () => care.care(kid, mapId, petId, 'feed'),
      (tx) => lockCoins(tx, kid.id),
    );
    expect(await coinRows(kid.id)).toEqual([{ source: 'care', amount: 1 }]);
  });

  it('pays care coins before the event (care `care`, #45)', async () => {
    const { kid, mapId, petId, care } = await careSetup('petter');
    // Hold the coins (a purchase), let a pet queue on them, then take `maps`
    // as an event would: the pet must not have appended its event yet.
    await holdThen(
      (tx) => lockCoins(tx, kid.id),
      () => care.care(kid, mapId, petId, 'pet'),
      (tx) => lockMapRow(tx, mapId),
    );
    expect(await coinRows(kid.id)).toEqual([{ source: 'care', amount: 1 }]);
  });

  it("pays a battle's coins after the squishy locks (battles `finish`, #45)", async () => {
    const { kid, heroId, battle, fights, finishing } = await oneMoveFromWinning('earner');
    await holdThen(
      (tx) => lockSquishy(tx, heroId),
      () => fights.act(kid, battle.id, finishing),
      (tx) => lockCoins(tx, kid.id),
    );
    expect((await coinRows(kid.id)).map((r) => r.source).sort()).toEqual(['battle', 'capture']);
  });

  it("pays a battle's coins before its events (battles `finish`, #45)", async () => {
    const { kid, mapId, battle, fights, finishing } = await oneMoveFromWinning('winner');
    await holdThen(
      (tx) => lockCoins(tx, kid.id),
      () => fights.act(kid, battle.id, finishing),
      (tx) => lockMapRow(tx, mapId),
    );
    expect((await coinRows(kid.id)).map((r) => r.source).sort()).toEqual(['battle', 'capture']);
  });

  it('picks a starter while the member is leaving, one at a time on the member row (starters `pick`, maps `leave`)', async () => {
    const owner = await player('owner');
    const kid = await player('picker');
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Lock Patch', timeZone: 'UTC', maxPlayers: 4 })
      .returning({ id: maps.id });
    const mapId = map!.id;
    await db.insert(mapMembers).values([
      { mapId, userId: owner.id, role: 'owner' },
      { mapId, userId: kid.id, role: 'member' },
    ]);
    const lockMember = (tx: Transaction) =>
      tx
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, kid.id)))
        .for('no key update');

    let picking: Promise<unknown> | undefined;
    let leaving: Promise<unknown> | undefined;
    // Another member-row locker (a challenge against this player) holds the
    // row; the pick queues on it first, then leaving, which already holds the
    // seats lock and the player's `users` row. The pick takes nothing after
    // the member row that leaving holds (its new squishy's foreign keys only
    // key-share `maps` and the member row), so both finish. A pick that locked
    // the player's `users` row after the member row would deadlock (40P01).
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await lockMember(tx);
      const pid = await backendPid(tx);
      picking = outcome(createStartersService({ db }).pick(kid, mapId, 'emberbun'));
      await waitUntilBlockedBy(db, pid);
      leaving = outcome(
        createMapsService({ db, tutorialRequired: false, keeperRequired: false }).leave(kid, mapId),
      );
      await waitUntilBlockedBy(db, pid, 2);
    });
    expect(await picking).toBe('ok');
    expect(await leaving).toBe('ok');

    const [membership] = await db
      .select({ status: mapMembers.status, starter: mapMembers.starterSquishyId })
      .from(mapMembers)
      .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, kid.id)));
    const owned = await db
      .select({ id: squishies.id })
      .from(squishies)
      .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, kid.id)));
    // The pick committed first; leaving keeps its marker on the archived row.
    expect(owned).toHaveLength(1);
    expect(membership).toEqual({ status: 'removed', starter: owned[0]!.id });
  });

  /*
   * Keeper milestones (#44): a consumer transaction takes `event_consumers`,
   * then the track's `milestone_progress` row, then the tier's
   * `milestone_rewards` row, then `coin_balances` (`creditCoins`), and never
   * `maps` (tech spec §7 step 12 note). Each test holds one side, lets the
   * milestone write queue there, then takes the other side: taken in the wrong
   * order, Postgres reports a deadlock (40P01) or the lock timeout fails it.
   */
  async function milestonePatch(
    prefix: string,
    finishedTutorial = false,
    play: 'rescue' | 'evolve' = 'rescue',
  ) {
    const kid = await player(prefix);
    if (finishedTutorial) {
      await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, kid.id));
    }
    const pal = await player(`${prefix}pal`);
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Lock Milestones', timeZone: 'UTC', maxPlayers: 4 })
      .returning({ id: maps.id });
    const mapId = map!.id;
    const joinedAt = new Date(Date.now() - 60_000);
    await db.insert(mapMembers).values([
      { mapId, userId: kid.id, role: 'owner', joinedAt },
      { mapId, userId: pal.id, role: 'member', joinedAt },
    ]);
    // A rescue reaches the Rescuer track's first tier: a reward, a piece and
    // coins. An evolution reaches Evolution's, whose id sorts before
    // "first-patch".
    await withTransaction(db, (tx) =>
      appendGameEvent(
        tx,
        play === 'rescue'
          ? {
              mapId,
              type: 'squishy.rescued',
              actorUserId: kid.id,
              payload: {
                userId: kid.id,
                squishyId: randomUUID(),
                battleId: randomUUID(),
                heartdust: 1,
              },
            }
          : {
              mapId,
              type: 'squishy.evolved',
              actorUserId: kid.id,
              payload: {
                userId: kid.id,
                squishyId: randomUUID(),
                fromSpeciesId: 'puddlepuff',
                intoSpeciesId: 'splashmallow',
                level: 16,
              },
            },
      ),
    );
    return { kid, mapId, consumer: createMilestonesConsumer() };
  }

  const milestoneCoins = async (userId: string) =>
    (await coinRows(userId)).filter((r) => r.source === 'milestone');

  it('counts milestone progress before paying its coins (milestones consumer, #44)', async () => {
    const { kid, mapId, consumer } = await milestonePatch('climber');
    await db
      .insert(milestoneProgress)
      .values({ userId: kid.id, milestoneId: 'rescuer', progress: 0, updatedAt: new Date() });
    // Hold the track's row (another patch's event for the same player), let
    // the consumer queue on it, then take the coins: it must not hold them yet.
    await holdThen(
      (tx) =>
        tx
          .select({ progress: milestoneProgress.progress })
          .from(milestoneProgress)
          .where(
            and(eq(milestoneProgress.userId, kid.id), eq(milestoneProgress.milestoneId, 'rescuer')),
          )
          .for('update'),
      () => runConsumer(db, consumer, mapId),
      (tx) => lockCoins(tx, kid.id),
    );
    expect(await milestoneCoins(kid.id)).toHaveLength(1);
  });

  it('takes the consumer position before the milestone rows (milestones consumer, #44)', async () => {
    const { kid, mapId, consumer } = await milestonePatch('queuer');
    // Hold the consumer's position (a second worker), then a milestone row
    // and the coins: the waiting consumer must hold none of them yet.
    await holdThen(
      (tx) => createJobsRepo(tx).lockPosition(consumer.name, mapId),
      () => runConsumer(db, consumer, mapId),
      async (tx) => {
        await tx
          .insert(milestoneProgress)
          .values({ userId: kid.id, milestoneId: 'rescuer', progress: 0, updatedAt: new Date() })
          .onConflictDoNothing();
        await lockCoins(tx, kid.id);
      },
    );
    expect(await milestoneCoins(kid.id)).toHaveLength(1);
  });

  it('records a milestone tier before paying its coins (milestones consumer, #44)', async () => {
    const { kid, mapId, consumer } = await milestonePatch('granter');
    const id = milestoneRewardId(kid.id, 'rescuer', 1);
    // Another path granting the same tier (the First Patch check, another
    // patch): hold its uncommitted reward row, let the consumer queue on the
    // unique key, then take the coins. The holder commits the row without
    // paying, so the consumer finds it granted and pays nothing.
    await holdThen(
      (tx) =>
        tx.insert(milestoneRewards).values({
          id,
          userId: kid.id,
          milestoneId: 'rescuer',
          tier: 1,
          mapId,
          earnedAt: new Date(),
        }),
      () => runConsumer(db, consumer, mapId),
      (tx) => lockCoins(tx, kid.id),
    );
    expect(await milestoneCoins(kid.id)).toEqual([]);
  });

  it("records The First Patch with a tier's other rewards before paying either (milestones consumer, #44)", async () => {
    // A finisher whose evolution reaches a tier (Evolution's id sorts before
    // The First Patch's, so its row comes first): the consumer grants both. Hold
    // the First Patch row (`GET /milestones` or the backfill granting it), let
    // the consumer queue on it, then take the coins. The consumer must not
    // have paid the Evolution tier's coins before recording every reward row.
    const { kid, mapId, consumer } = await milestonePatch('finished', true, 'evolve');
    await holdThen(
      (tx) =>
        tx.insert(milestoneRewards).values({
          id: milestoneRewardId(kid.id, 'first-patch', 1),
          userId: kid.id,
          milestoneId: 'first-patch',
          tier: 1,
          mapId: null,
          earnedAt: new Date(),
        }),
      () => runConsumer(db, consumer, mapId),
      (tx) => lockCoins(tx, kid.id),
    );
    // The holder recorded The First Patch without paying; the consumer paid the evolution.
    expect((await milestoneCoins(kid.id)).map((r) => r.amount)).toEqual([25]);
  });

  it('grants The First Patch before paying its coins (milestones `get`, #44)', async () => {
    const kid = await player('finisher');
    await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, kid.id));
    const id = milestoneRewardId(kid.id, 'first-patch', 1);
    const service = createMilestonesService({ db });
    await holdThen(
      (tx) =>
        tx.insert(milestoneRewards).values({
          id,
          userId: kid.id,
          milestoneId: 'first-patch',
          tier: 1,
          mapId: null,
          earnedAt: new Date(),
        }),
      () => service.get(kid),
      (tx) => lockCoins(tx, kid.id),
    );
    expect(await milestoneCoins(kid.id)).toEqual([]);
  });
});
