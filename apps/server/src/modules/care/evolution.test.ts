import {
  CareListResponseSchema,
  CareResponseSchema,
  GAME_DATA,
  GROWTH_RULES,
  MapResponseSchema,
  xpForLevel,
} from '@heartpatch/shared';
import { EVOLUTION_RULES, SERVER_GAME_DATA, rollEvolution } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, squishyEvolutions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import {
  EVOLUTION_CONTENT_HASH,
  addNightWatchLean,
  formsAt,
  type LoggedRoll,
} from './evolution.js';
import { createCareRepo } from './repo.js';
import { applyXp, growthEvents } from './service.js';

/*
 * Branching evolution on the server (#32): rolls, pity, logging and replay,
 * the feeling lean, whispers, and squishies that evolved before #32.
 * Reads the shipped data, so the cases follow whichever public branch ships
 * first (a feeling branch at its line's first step).
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
const START = '2026-10-02T18:00:00Z';
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};

/** The first public line with a feeling branch, and its forms. */
const ODDS = SERVER_GAME_DATA.evolutionOdds.find((o) => o.trigger.kind === 'feeling')!;
const BRANCH_FEELING = ODDS.trigger.kind === 'feeling' ? ODDS.trigger.feeling : 'joy';
const speciesOf = (id: string) => GAME_DATA.species.find((s) => s.id === id)!;
const BASE = speciesOf(ODDS.from);
const STEP = BASE.evolutions.find((e) => e.into === ODDS.into)!;
const DEFAULT = speciesOf(BASE.evolutions[0]!.into);
const BRANCH = speciesOf(ODDS.into);

describe.skipIf(!url)('branching evolution (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(START));
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player() {
    const username = `brancher_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, token };
  }
  type Player = Awaited<ReturnType<typeof player>>;

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Branch Patch', timeZone: 'UTC' });
    expect(res.statusCode, res.body).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  /** One of `who`'s squishies, by default the branching line's base form one level short. */
  async function squishy(
    mapId: string,
    who: Player,
    values: Partial<typeof squishies.$inferInsert> = {},
  ): Promise<string> {
    const level = values.level ?? STEP.level - 1;
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: BASE.id,
        element: BASE.element,
        feeling: BASE.feeling,
        level,
        xp: xpForLevel(level, GROWTH_RULES),
        ...values,
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  /** Plain XP to its step's level, as Training Grounds lands it. */
  const grow = (id: string, levels = 1, won = false) =>
    withTransaction(db, async (tx) => {
      const row = await createCareRepo(tx).findSquishy(id);
      const need = xpForLevel(row!.level + levels, GROWTH_RULES) - row!.xp;
      return applyXp(tx, id, need, clock, { plain: true, won });
    });

  const rowOf = async (id: string) =>
    (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const evolutionsOf = (id: string) =>
    db.query.squishyEvolutions.findMany({ where: (t, { eq }) => eq(t.squishyId, id) });

  /** Lean so strong one feeling always wins. */
  const leaning = (feeling: string) => ({
    feelingLean: { [feeling]: 50 },
    feelingLeanAt: clock,
  });

  it('keeps squishies that evolved before #32 as they are', async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    const id = await squishy(mapId, who, {
      speciesId: DEFAULT.id,
      element: DEFAULT.element,
      feeling: DEFAULT.feeling,
      level: STEP.level + 2,
    });
    await db.insert(squishyEvolutions).values({
      mapId,
      squishyId: id,
      fromSpeciesId: BASE.id,
      intoSpeciesId: DEFAULT.id,
      level: STEP.level,
      evolvedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const growth = await grow(id, 3);
    expect(growth?.evolutions).toEqual([]);
    expect((await rowOf(id)).speciesId).toBe(DEFAULT.id);
    const [old] = await evolutionsOf(id);
    expect(old).toMatchObject({ userId: null, branch: false, roll: null });
  });

  it('rolls a branching step, logs the roll and replays it to the same pick', async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    const id = await squishy(mapId, who, leaning(BRANCH_FEELING));
    const growth = await grow(id);
    const evolution = growth!.evolutions[0]!;
    const [row] = await evolutionsOf(id);
    const roll = row!.roll as unknown as LoggedRoll;
    expect(row).toMatchObject({ userId: who.id, intoSpeciesId: evolution.intoSpeciesId });
    expect(roll).toMatchObject({
      contentHash: EVOLUTION_CONTENT_HASH,
      pick: evolution.intoSpeciesId,
    });
    expect(roll.inputs.dominant).toBe(BRANCH_FEELING);
    expect(roll.weights.map((w) => w.into)).toEqual([DEFAULT.id, BRANCH.id]);
    expect(row!.branch).toBe(roll.branch);
    expect(evolution.branch).toBe(roll.branch);

    // Replaying the logged inputs gives the same pick (coordinator condition 4).
    const replay = rollEvolution(
      roll.seed,
      formsAt(BASE.id, STEP.level),
      roll.inputs,
      EVOLUTION_RULES,
    );
    expect(replay.pick).toBe(roll.pick);
    expect(replay.u).toBe(roll.u);

    // The event says whether it's a branch; the default form keeps its own feeling,
    // a branch form takes the branch's.
    const [event] = growthEvents([growth!]).filter((e) => e.type === 'squishy.evolved');
    expect(event?.payload).toMatchObject({ branch: roll.branch });
    expect((await rowOf(id)).feeling).toBe(roll.branch ? BRANCH.feeling : BASE.feeling);
  });

  it("makes an aimed branch certain after the player's two aimed misses (pity)", async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    for (let i = 0; i < EVOLUTION_RULES.pity.guaranteeAfter; i++) {
      const old = await squishy(mapId, who, { speciesId: DEFAULT.id, element: DEFAULT.element });
      await db.insert(squishyEvolutions).values({
        mapId,
        squishyId: old,
        userId: who.id,
        fromSpeciesId: BASE.id,
        intoSpeciesId: DEFAULT.id,
        level: STEP.level,
        evolvedAt: new Date(Date.parse(START) - (i + 1) * DAY_MS),
        roll: { aimedMisses: [BRANCH.id] },
      });
    }
    const id = await squishy(mapId, who, leaning(BRANCH_FEELING));
    const growth = await grow(id);
    expect(growth?.evolutions).toEqual([
      { fromSpeciesId: BASE.id, intoSpeciesId: BRANCH.id, branch: true },
    ]);
    const [row] = await evolutionsOf(id);
    expect((row!.roll as unknown as LoggedRoll).inputs.pity).toEqual({
      [BRANCH.id]: EVOLUTION_RULES.pity.guaranteeAfter,
    });
  });

  it('never rolls a step with one form', async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    const single = GAME_DATA.species.find(
      (s) => s.evolutions.length === 1 && formsAt(s.id, 100).length === 1,
    )!;
    const level = single.evolutions[0]!.level - 1;
    const id = await squishy(mapId, who, {
      speciesId: single.id,
      element: single.element,
      feeling: single.feeling,
      level,
      xp: xpForLevel(level, GROWTH_RULES),
    });
    const growth = await grow(id);
    expect(growth?.evolutions).toEqual([
      { fromSpeciesId: single.id, intoSpeciesId: single.evolutions[0]!.into, branch: false },
    ]);
    expect((await evolutionsOf(id))[0]).toMatchObject({
      roll: null,
      branch: false,
      userId: who.id,
    });
  });

  it('leans with full-value care and counts care history; a win leans Brave', async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    const id = await squishy(mapId, who, { level: 3, xp: xpForLevel(3, GROWTH_RULES) });
    const res = await call(server, 'POST', `/maps/${mapId}/squishies/${id}/care`, who, {
      action: 'pet',
    });
    expect(res.statusCode, res.body).toBe(200);
    const { result } = CareResponseSchema.parse(res.json());
    expect(result.full).toBe(true);
    const after = await rowOf(id);
    const pet = EVOLUTION_RULES.lean.care['pet']!;
    expect(after.feelingLean[pet.feeling]).toBe(
      pet.points + (pet.feeling === BASE.feeling ? EVOLUTION_RULES.lean.headStart : 0),
    );
    expect(after.careSamples).toBe(1);
    expect(after.careSum).toBeGreaterThan(0);

    await grow(id, 1, true);
    const won = await rowOf(id);
    expect(won.feelingLean[EVOLUTION_RULES.lean.win.feeling]).toBeGreaterThanOrEqual(
      EVOLUTION_RULES.lean.win.points,
    );
  });

  it('leans Spooky for standing watch at night', async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    const id = await squishy(mapId, who);
    await withTransaction(db, (tx) => addNightWatchLean(tx, [id], clock));
    const { feeling, points } = EVOLUTION_RULES.lean.nightWatch;
    expect((await rowOf(id)).feelingLean[feeling]).toBeGreaterThanOrEqual(points);
  });

  it('whispers in the care sheet from half the evolving meter, never with a form or a number', async () => {
    const server = await start();
    const who = await player();
    const mapId = await newMap(server, who);
    const near = await squishy(mapId, who, { ...leaning(BRANCH_FEELING), joinedLevel: 1 });
    const far = await squishy(mapId, who, {
      level: 2,
      xp: xpForLevel(2, GROWTH_RULES),
      joinedLevel: 1,
    });
    const res = await call(server, 'GET', `/maps/${mapId}/care`, who);
    expect(res.statusCode, res.body).toBe(200);
    const sheet = CareListResponseSchema.parse(res.json());
    const whisper = sheet.squishies.find((s) => s.id === near)!.whisper;
    expect(whisper?.icon).toBeTruthy();
    expect(whisper?.text).toContain(BASE.name);
    expect(whisper?.sub).toBeTruthy();
    expect(JSON.stringify(whisper)).not.toMatch(new RegExp(`${BRANCH.name}|${DEFAULT.name}|\\d|%`));
    expect(sheet.squishies.find((s) => s.id === far)!.whisper).toBeNull();
    // No odds, weights or conditions anywhere in the reply.
    expect(res.body).not.toMatch(/"(weights|trigger|pity|aimed)"/);
  });
});
