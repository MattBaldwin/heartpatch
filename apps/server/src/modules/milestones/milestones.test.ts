import { randomUUID } from 'node:crypto';
import {
  MapResponseSchema,
  MILESTONE_TRACKS,
  MILESTONE_UNIT,
  MilestonesResponseSchema,
  type MilestonesResponse,
  type MilestoneTrack,
  type MilestoneTrackView,
} from '@heartpatch/shared';
import { SECRET_MILESTONES } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  keepers,
  mapMembers,
  maps,
  milestoneProgress,
  milestoneRewards,
  sessions,
  users,
} from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createMapsService } from '../maps/service.js';
import { createTutorialTxRepo } from '../tutorial/repo.js';
import { createMilestonesConsumer } from './consumer.js';
import { createMilestonesService, milestoneRewardId } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('Keeper milestones (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  // In the 2026 Halloween window (Oct 1 – Nov 9).
  let clock = new Date('2026-10-03T12:00:00Z');
  let counter = 0;
  const consumer = createMilestonesConsumer({ clock: () => clock });

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date('2026-10-03T12:00:00Z');
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(
    options: { keeper?: boolean; finishedTutorial?: Date } = {},
  ): Promise<Player> {
    const username = `milekid_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
        timeZone: 'UTC',
        tutorialCompletedAt: options.finishedTutorial ?? null,
      })
      .returning({ id: users.id });
    if (options.keeper !== false)
      await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      // Long enough for the tests that move the clock past Halloween.
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 365 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  /** A bare patch with these active members, who joined a minute before the game clock. */
  async function patch(members: Player[], kind: 'multiplayer' | 'tutorial' = 'multiplayer') {
    const [map] = await db
      .insert(maps)
      .values({ kind, name: 'Milestone Patch', timeZone: 'UTC', maxPlayers: 4 })
      .returning({ id: maps.id });
    const joinedAt = new Date(clock.getTime() - 60_000);
    await db.insert(mapMembers).values(
      members.map((m, i) => ({
        mapId: map!.id,
        userId: m.id,
        role: i === 0 ? ('owner' as const) : ('member' as const),
        joinedAt,
      })),
    );
    return map!.id;
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    body?: unknown,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });

  const milestones = async (server: FastifyInstance, who: Player): Promise<MilestonesResponse> => {
    const res = await call(server, 'GET', '/milestones', who);
    expect(res.statusCode).toBe(200);
    return MilestonesResponseSchema.parse(res.json());
  };

  const trackOf = (view: MilestonesResponse, id: string) =>
    view.tracks.find(
      (t): t is Extract<MilestoneTrackView, { hidden: false }> => !t.hidden && t.id === id,
    );

  const earned = (view: MilestonesResponse, id: string) =>
    trackOf(view, id)
      ?.tiers.filter((t) => t.earnedAt !== null)
      .map((t) => t.tier) ?? [];

  const append = (event: NewGameEvent) => db.transaction((tx) => appendGameEvent(tx, event));
  const run = (mapId: string) => runConsumer(db, consumer, mapId);

  // ── Event builders (internal payloads) ────────────────────────────────
  const tileCaptured = (mapId: string, who: Player, rewardPercent = 100): NewGameEvent => ({
    mapId,
    type: 'tile.captured',
    actorUserId: who.id,
    payload: {
      attackId: randomUUID(),
      battleId: randomUUID(),
      kind: 'tile',
      userId: who.id,
      fromUserId: null,
      q: 1,
      r: 0,
      terrain: 'meadow',
      rewardPercent,
      returnedSquishyIds: [],
    },
  });
  const captured = (mapId: string, who: Player, speciesId: string): NewGameEvent => ({
    mapId,
    type: 'squishy.captured',
    actorUserId: who.id,
    payload: {
      battleId: randomUUID(),
      userId: who.id,
      squishyId: randomUUID(),
      speciesId,
      level: 3,
    },
  });
  const evolved = (mapId: string, who: Player): NewGameEvent => ({
    mapId,
    type: 'squishy.evolved',
    actorUserId: who.id,
    payload: {
      userId: who.id,
      squishyId: randomUUID(),
      fromSpeciesId: 'puddlepuff',
      intoSpeciesId: 'splashmallow',
      level: 16,
    },
  });
  const cared = (mapId: string, who: Player, full = true): NewGameEvent => ({
    mapId,
    type: 'squishy.cared',
    actorUserId: who.id,
    payload: {
      userId: who.id,
      squishyId: randomUUID(),
      action: 'pet',
      contentment: 60,
      gained: full ? 10 : 1,
      full,
      coins: 0,
      day: '2026-10-03',
      mood: 'happy',
    },
  });
  const raid = (mapId: string, attacker: Player, defender: Player): NewGameEvent => ({
    mapId,
    type: 'raid.resolved',
    actorUserId: null,
    payload: {
      raidId: randomUUID(),
      battleId: randomUUID(),
      attackerUserId: attacker.id,
      defenderUserId: defender.id,
      q: 2,
      r: 0,
      outcome: 'held',
    },
  });
  const rescued = (mapId: string, who: Player): NewGameEvent => ({
    mapId,
    type: 'squishy.rescued',
    actorUserId: who.id,
    payload: { userId: who.id, squishyId: randomUUID(), battleId: randomUUID(), heartdust: 1 },
  });
  const found = (mapId: string, who: Player, itemId: string): NewGameEvent => ({
    mapId,
    type: 'clothing.found',
    actorUserId: who.id,
    payload: { userId: who.id, itemId, source: 'gather', refId: randomUUID() },
  });
  const gathered = (mapId: string, who: Player): NewGameEvent => ({
    mapId,
    type: 'resource.gathered',
    actorUserId: who.id,
    payload: {
      gatherId: randomUUID(),
      userId: who.id,
      q: 0,
      r: 1,
      resource: 'pumpkins',
      items: { pumpkins: 2 },
    },
  });
  const dressed = (mapId: string, who: Player, wearing: string[]): NewGameEvent => ({
    mapId,
    type: 'outfit.changed',
    actorUserId: who.id,
    payload: { userId: who.id, wearing },
  });
  const leveled = (mapId: string, who: Player, level: number): NewGameEvent => ({
    mapId,
    type: 'squishy.leveled',
    actorUserId: who.id,
    payload: { userId: who.id, squishyId: randomUUID(), fromLevel: level - 1, level, xp: 9000 },
  });

  // Reads use the relational query API: only repos import drizzle-orm (lint rule).
  const coinRows = (userId: string) =>
    db.query.coinLedger.findMany({
      columns: { source: true, refId: true, amount: true },
      where: (t, { eq }) => eq(t.userId, userId),
    });
  const balance = async (userId: string) =>
    (await db.query.coinBalances.findFirst({ where: (t, { eq }) => eq(t.userId, userId) }))
      ?.balance ?? 0;
  const pieces = (userId: string) =>
    db.query.clothingOwned.findMany({
      columns: { itemId: true, source: true, refId: true },
      where: (t, { eq }) => eq(t.userId, userId),
    });
  const rewardIds = async (userId: string) =>
    (
      await db.query.milestoneRewards.findMany({
        columns: { id: true },
        where: (t, { eq }) => eq(t.userId, userId),
      })
    ).map((r) => r.id);
  /** Finishes the tutorial as the step engine does (`users.tutorial_completed_at`, once). */
  const finishTutorial = (userId: string, at: Date) =>
    db.transaction((tx) => createTutorialTxRepo(tx).complete(userId, at));

  const tier = (trackId: string, n: number) => {
    const found = [...MILESTONE_TRACKS, ...SECRET_MILESTONES].find((t) => t.id === trackId);
    const data = found?.tiers[n - 1];
    if (!data) throw new Error(`no tier ${trackId}/${String(n)}`);
    return data;
  };

  it('counts each track from its event on a patch with two players', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    for (let i = 0; i < 10; i += 1) await append(tileCaptured(mapId, kid));
    for (const species of ['puddlepuff', 'emberbun', 'thistlepip', 'puddlepuff']) {
      await append(captured(mapId, kid, species));
    }
    await append(evolved(mapId, kid));
    await append(cared(mapId, kid));
    await append(cared(mapId, kid, false)); // past the first few today: not counted
    await append(raid(mapId, pal, kid));
    await append(rescued(mapId, kid));
    await append(gathered(mapId, kid));
    await append(found(mapId, kid, 'witch-hat'));
    await run(mapId);

    const view = await milestones(server, kid);
    const progress = Object.fromEntries(
      view.tracks.flatMap((t) => (t.hidden ? [] : [[t.id, t.progress]])),
    );
    expect(progress).toEqual({
      'first-patch': 0,
      territory: 10,
      collector: 3, // three kinds; the second Puddlepuff is the same kind
      evolution: 1,
      caretaker: 1,
      defender: 1,
      rescuer: 1,
      halloween: 2, // the pumpkins and the Witch Hat
    });
    expect(earned(view, 'territory')).toEqual([1]);
    expect(earned(view, 'collector')).toEqual([1]);
    expect(earned(view, 'evolution')).toEqual([1]);
    expect(earned(view, 'defender')).toEqual([1]);
    expect(earned(view, 'rescuer')).toEqual([1]);
    expect(earned(view, 'caretaker')).toEqual([]);
    // The challenger gets nothing for land the defender held.
    expect(trackOf(await milestones(server, pal), 'defender')?.progress).toBe(0);
    // Every tier's title, in the order earned, and news to celebrate.
    expect(view.titles.map((t) => t.id).sort()).toEqual(
      ['hollow-rescuer', 'proud-keeper', 'squishy-pal', 'trailblazer', 'watchful'].sort(),
    );
    expect(view.news).toHaveLength(5);
  });

  it('counts the secret ones by their hidden conditions, and only then shows them', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    const before = await milestones(server, kid);
    expect(before.tracks.filter((t) => t.hidden)).toHaveLength(SECRET_MILESTONES.length);

    await append(leveled(mapId, kid, 19));
    await append(dressed(mapId, kid, ['a', 'b', 'c', 'd', 'e', 'f']));
    await run(mapId);
    expect((await milestones(server, kid)).tracks.filter((t) => t.hidden)).toHaveLength(
      SECRET_MILESTONES.length,
    );

    await append(leveled(mapId, kid, 20));
    await append(dressed(mapId, kid, ['a', 'b', 'c', 'd', 'e', 'f', 'g']));
    await append(found(mapId, kid, 'cloud-onesie'));
    await append(captured(mapId, kid, 'heartlet'));
    await run(mapId);
    const after = await milestones(server, kid);
    expect(after.tracks.filter((t) => t.hidden)).toHaveLength(0);
    for (const secret of SECRET_MILESTONES) {
      expect(earned(after, secret.id)).toEqual([1]);
      expect(trackOf(after, secret.id)?.secret).toBe(true);
    }
  });

  it('never sends a secret milestone before it is earned', async () => {
    const server = await start();
    const kid = await player();
    const body = (await call(server, 'GET', '/milestones', kid)).body;
    const secrets = SECRET_MILESTONES.flatMap((t) => [
      t.id,
      t.name,
      ...t.tiers.flatMap((tier) => [tier.goal, tier.title.id, tier.title.name]),
    ]);
    for (const secret of [...secrets, 'heartlet', 'wearing.length', 'atLeast', 'eventType']) {
      expect(body).not.toContain(secret);
    }
    // The Milestones screen still knows how many there are to find.
    expect(
      MilestonesResponseSchema.parse(JSON.parse(body)).tracks.filter((t) => t.hidden),
    ).toHaveLength(SECRET_MILESTONES.length);
  });

  it("shows a revealed secret track's earned tiers only, not its later ones", async () => {
    const kid = await player();
    // A secret with a second tier the player hasn't reached (the launch
    // secrets have one tier each, so this is the case that could leak).
    const base = SECRET_MILESTONES[0]!;
    const later = {
      threshold: 5,
      goal: 'A later secret goal nobody should read yet.',
      title: { id: 'later-secret-title', name: 'Later Secret Title' },
      coins: 10,
    };
    const secret: MilestoneTrack = { ...base, tiers: [base.tiers[0]!, later] };
    await db.insert(milestoneRewards).values({
      id: milestoneRewardId(kid.id, secret.id, 1),
      userId: kid.id,
      milestoneId: secret.id,
      tier: 1,
      mapId: null,
      earnedAt: clock,
    });
    await db.insert(milestoneProgress).values({
      userId: kid.id,
      milestoneId: secret.id,
      progress: 3 * MILESTONE_UNIT,
      updatedAt: clock,
    });

    const view = await createMilestonesService({ db, tracks: [secret] }).get(kid);
    const shown = trackOf(view, secret.id);
    expect(shown?.tiers.map((t) => t.tier)).toEqual([1]);
    // Not "3 of 5": how near the hidden tier is stays hidden too.
    expect(shown?.progress).toBe(1);
    const body = JSON.stringify(view);
    for (const text of [later.goal, later.title.id, later.title.name]) {
      expect(body).not.toContain(text);
    }
  });

  it("scales a Gentle capture by its share (DECISIONS 'Territory (#15)')", async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    for (let i = 0; i < 19; i += 1) await append(tileCaptured(mapId, kid, 50));
    await run(mapId);
    // 19 half tiles are 9.5 tiles: not 10 yet.
    let view = await milestones(server, kid);
    expect(trackOf(view, 'territory')?.progress).toBe(9);
    expect(earned(view, 'territory')).toEqual([]);
    await append(tileCaptured(mapId, kid, 50));
    await run(mapId);
    view = await milestones(server, kid);
    expect(trackOf(view, 'territory')?.progress).toBe(10);
    expect(earned(view, 'territory')).toEqual([1]);
  });

  it('counts nothing on a patch with one player, and counts once a second joins (decision F)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch([kid]);
    await append(rescued(mapId, kid));
    await run(mapId);
    expect(trackOf(await milestones(server, kid), 'rescuer')?.progress).toBe(0);

    // A friend joins after that rescue was counted: it stays uncounted, the next one counts.
    // (The test clock stands still, so "joined" is a minute back, like `patch`.)
    const pal = await player();
    await db.insert(mapMembers).values({
      mapId,
      userId: pal.id,
      role: 'member',
      joinedAt: new Date(clock.getTime() - 60_000),
    });
    await append(rescued(mapId, kid));
    await run(mapId);
    expect(trackOf(await milestones(server, kid), 'rescuer')?.progress).toBe(1);

    // A member who left doesn't count either.
    const other = await player();
    const left = await patch([other]);
    await db
      .insert(mapMembers)
      .values({ mapId: left, userId: pal.id, role: 'member', status: 'removed' });
    await append(rescued(left, other));
    await run(left);
    expect(trackOf(await milestones(server, other), 'rescuer')?.progress).toBe(0);
  });

  it("doesn't count a member's play from before they joined", async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid]);
    await append(rescued(mapId, kid));
    // The second member's row says they joined after the rescue.
    await db.insert(mapMembers).values({
      mapId,
      userId: pal.id,
      role: 'member',
      joinedAt: new Date(clock.getTime() + 60_000),
    });
    await run(mapId);
    expect(trackOf(await milestones(server, kid), 'rescuer')?.progress).toBe(0);
  });

  it('counts nothing on the Tutorial Glade, except The First Patch', async () => {
    const server = await start();
    const kid = await player();
    const glade = await patch([kid], 'tutorial');
    await append(rescued(glade, kid));
    await append(captured(glade, kid, 'puddlepuff'));
    await append({
      mapId: glade,
      type: 'tutorial.advanced',
      actorUserId: null,
      payload: { completedStepId: 'welcome', stepId: 'plant' },
    });
    await run(glade);
    let view = await milestones(server, kid);
    expect(trackOf(view, 'rescuer')?.progress).toBe(0);
    expect(trackOf(view, 'collector')?.progress).toBe(0);
    expect(earned(view, 'first-patch')).toEqual([]);

    // Finishing: the step engine sets the completion, then writes the last step.
    await finishTutorial(kid.id, clock);
    await append({
      mapId: glade,
      type: 'tutorial.advanced',
      actorUserId: null,
      payload: { completedStepId: 'graduation', stepId: null },
    });
    await run(glade);
    view = await milestones(server, kid);
    expect(earned(view, 'first-patch')).toEqual([1]);
    expect(trackOf(view, 'first-patch')?.progress).toBe(1);
    expect(view.titles.map((t) => t.id)).toEqual(['sprouts-friend']);
    const id = milestoneRewardId(kid.id, 'first-patch', 1);
    expect(await coinRows(kid.id)).toEqual([
      { source: 'milestone', refId: id, amount: tier('first-patch', 1).coins },
    ]);
  });

  it('grants The First Patch on the next check, and backfills earlier finishers once', async () => {
    const server = await start();
    const early = await player({ finishedTutorial: new Date('2026-10-01T09:00:00Z') });
    const later = await player();
    const service = createMilestonesService({ db, clock: () => clock });
    // Other test files' finishers may be backfilled too; ours must be among them, once.
    expect(await service.backfillTutorial()).toBeGreaterThanOrEqual(1);
    expect(await service.backfillTutorial()).toBe(0);
    expect(earned(await milestones(server, early), 'first-patch')).toEqual([1]);
    expect(await coinRows(early.id)).toHaveLength(1);

    // Finished after the backfill ran: the next look at milestones grants it.
    await finishTutorial(later.id, clock);
    expect(earned(await milestones(server, later), 'first-patch')).toEqual([1]);
    expect(earned(await milestones(server, later), 'first-patch')).toEqual([1]);
    expect(await coinRows(later.id)).toHaveLength(1);

    // Not finished: nothing.
    const fresh = await player();
    expect(earned(await milestones(server, fresh), 'first-patch')).toEqual([]);
  });

  it('grants each tier exactly once when an event is redelivered or retried', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    const event = await append(rescued(mapId, kid));

    // A retry that failed after granting rolls everything back with it.
    await expect(
      db.transaction(async (tx) => {
        await consumer.handle(tx, event);
        throw new Error('the worker fell over');
      }),
    ).rejects.toThrow('the worker fell over');
    expect(await rewardIds(kid.id)).toEqual([]);

    // Delivered twice (a re-run after a crash between commit and `last_seq`).
    await db.transaction((tx) => consumer.handle(tx, event));
    await db.transaction((tx) => consumer.handle(tx, event));
    await run(mapId);
    await run(mapId);

    const view = await milestones(server, kid);
    expect(earned(view, 'rescuer')).toEqual([1]);
    const id = milestoneRewardId(kid.id, 'rescuer', 1);
    // Coins arrive once, through `creditCoins`, against the reward's id.
    expect(await coinRows(kid.id)).toEqual([
      { source: 'milestone', refId: id, amount: tier('rescuer', 1).coins },
    ]);
    expect(await balance(kid.id)).toBe(tier('rescuer', 1).coins);
    expect(await pieces(kid.id)).toEqual([
      { itemId: tier('rescuer', 1).clothing, source: 'milestone', refId: id },
    ]);
    expect(await rewardIds(kid.id)).toEqual([id]);
  });

  it('gives each player their own piece, with their own ref', async () => {
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    await append(rescued(mapId, kid));
    await append(rescued(mapId, pal));
    await run(mapId);
    const scarf = tier('rescuer', 1).clothing;
    expect(await pieces(kid.id)).toEqual([
      { itemId: scarf, source: 'milestone', refId: milestoneRewardId(kid.id, 'rescuer', 1) },
    ]);
    expect(await pieces(pal.id)).toEqual([
      { itemId: scarf, source: 'milestone', refId: milestoneRewardId(pal.id, 'rescuer', 1) },
    ]);
    expect(milestoneRewardId(kid.id, 'rescuer', 1)).not.toBe(
      milestoneRewardId(pal.id, 'rescuer', 1),
    );
    // It's in their wardrobe.
    const server = await start();
    const res = await call(server, 'GET', '/wardrobe', kid);
    expect(JSON.stringify(res.json())).toContain(scarf);
  });

  it('judges membership and seasons on the game clock, even far from the database clock', async () => {
    // `HP_DEV_NOW` a month ahead: members join, and play, on the game clock.
    clock = new Date(Date.now() + 30 * DAY_MS);
    if (clock.getTime() > Date.parse('2026-11-09T00:00:00Z'))
      clock = new Date('2026-11-01T12:00:00Z');
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    await append(rescued(mapId, kid));
    await run(mapId);
    expect(trackOf(await milestones(server, kid), 'rescuer')?.progress).toBe(1);
  });

  it('counts Halloween things only in the Halloween window', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    clock = new Date('2026-12-15T12:00:00Z');
    await append(gathered(mapId, kid));
    await run(mapId);
    expect(trackOf(await milestones(server, kid), 'halloween')?.progress).toBe(0);
    clock = new Date('2026-10-20T12:00:00Z');
    await append(gathered(mapId, kid));
    await run(mapId);
    expect(trackOf(await milestones(server, kid), 'halloween')?.progress).toBe(1);
  });

  it('marks news seen, for my own rewards only', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    await append(rescued(mapId, kid));
    await append(rescued(mapId, pal));
    await run(mapId);
    const mine = (await milestones(server, kid)).news;
    const theirs = (await milestones(server, pal)).news;
    expect(mine.map((n) => n.trackName)).toEqual(['Rescuer']);
    // Someone else's ids change nothing.
    const res = await call(server, 'POST', '/milestones/seen', kid, {
      ids: [...mine.map((n) => n.id), ...theirs.map((n) => n.id)],
    });
    expect(res.statusCode).toBe(200);
    expect(MilestonesResponseSchema.parse(res.json()).news).toEqual([]);
    expect((await milestones(server, pal)).news).toHaveLength(1);
  });

  it('wears an earned title on the profile card, and only an earned one', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const map = await createMapsService({
      db,
      clock: () => new Date(clock.getTime() - 60_000),
      tutorialRequired: false,
      keeperRequired: false,
    }).create({ id: kid.id, username: kid.username }, { name: 'Title Patch', timeZone: 'UTC' });
    await db.insert(mapMembers).values({
      mapId: map.id,
      userId: pal.id,
      role: 'member',
      joinedAt: new Date(clock.getTime() - 60_000),
    });

    const refused = await call(server, 'POST', '/milestones/title', kid, {
      titleId: 'hollow-rescuer',
    });
    expect(refused.statusCode).toBe(403);
    const unknown = await call(server, 'POST', '/milestones/title', kid, {
      titleId: 'no-such-title',
    });
    expect(unknown.statusCode).toBe(403);

    await append(rescued(map.id, kid));
    await run(map.id);
    const worn = await call(server, 'POST', '/milestones/title', kid, {
      titleId: 'hollow-rescuer',
    });
    expect(worn.statusCode).toBe(200);
    expect(MilestonesResponseSchema.parse(worn.json()).equippedTitleId).toBe('hollow-rescuer');

    // The other member sees it next to the name.
    const detail = MapResponseSchema.parse(
      (await call(server, 'GET', `/maps/${map.id}`, pal)).json(),
    ).map;
    const shown = Object.fromEntries(detail.members.map((m) => [m.user.id, m.title]));
    expect(shown).toEqual({ [kid.id]: 'Hollow Rescuer', [pal.id]: null });

    const off = await call(server, 'POST', '/milestones/title', kid, { titleId: null });
    expect(MilestonesResponseSchema.parse(off.json()).equippedTitleId).toBeNull();

    // No Keeper, no profile card to put it on.
    const keeperless = await player({ keeper: false, finishedTutorial: clock });
    expect(earned(await milestones(server, keeperless), 'first-patch')).toEqual([1]);
    const noCard = await call(server, 'POST', '/milestones/title', keeperless, {
      titleId: 'sprouts-friend',
    });
    expect(noCard.statusCode).toBe(409);
  });

  it('keeps progress on the account, the same from any device', async () => {
    const kid = await player();
    const pal = await player();
    const mapId = await patch([kid, pal]);
    await append(evolved(mapId, kid));
    await run(mapId);
    const rows = await db.query.milestoneProgress.findMany({
      columns: { milestoneId: true, progress: true },
      where: (t, { eq }) => eq(t.userId, kid.id),
    });
    expect(rows).toEqual([{ milestoneId: 'evolution', progress: 100 }]);
    // A second session (another device) reads the same.
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: kid.id, tokenHash, expiresAt: new Date(Date.now() + DAY_MS) });
    const server = await start();
    const one = await milestones(server, kid);
    const two = await milestones(server, { ...kid, token });
    expect(two).toEqual(one);
  });
});
