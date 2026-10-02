import {
  ApiErrorSchema,
  defaultKeeperConfig,
  KEEPER_DATA,
  JoinMapResponseSchema,
  KeeperResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  SetKeeperResponseSchema,
  type KeeperConfig,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { KEEPER_RATE_LIMITS } from './limits.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;

const [PIP, CLOVER] = KEEPER_DATA.bases;
const PIP_KEEPER = defaultKeeperConfig(PIP!);
const CLOVER_KEEPER: KeeperConfig = { ...defaultKeeperConfig(CLOVER!), hairColor: 'mint' };

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('keepers (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date('2026-10-02T12:00:00Z');
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date('2026-10-02T12:00:00Z');
  });

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...env });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /** A logged-in player with no Keeper yet, written straight to the database. */
  async function player(): Promise<Player> {
    const username = `keeperkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function getKeeper(server: FastifyInstance, who: Player) {
    const res = await call(server, 'GET', '/keeper', who);
    expect(res.statusCode).toBe(200);
    return KeeperResponseSchema.parse(res.json()).keeper;
  }

  async function saveKeeper(server: FastifyInstance, who: Player, keeper: KeeperConfig) {
    const res = await call(server, 'POST', '/keeper', who, keeper);
    expect(res.statusCode).toBe(200);
    return SetKeeperResponseSchema.parse(res.json()).keeper;
  }

  const newMap = (server: FastifyInstance, who: Player) =>
    call(server, 'POST', '/maps', who, { name: 'Keeper Hollow', timeZone: 'America/Chicago' });

  it('needs a logged-in player', async () => {
    const server = await start();
    expect(errorOf(await call(server, 'GET', '/keeper', null)).code).toBe('UNAUTHENTICATED');
    expect(errorOf(await call(server, 'POST', '/keeper', null, PIP_KEEPER)).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('has no Keeper until the player picks one, then keeps it', async () => {
    const server = await start();
    const kid = await player();
    expect(await getKeeper(server, kid)).toBeNull();
    expect(await saveKeeper(server, kid, PIP_KEEPER)).toEqual(PIP_KEEPER);
    expect(await getKeeper(server, kid)).toEqual(PIP_KEEPER);
  });

  it('changes for free, any time, in one row per player', async () => {
    const server = await start();
    const kid = await player();
    await saveKeeper(server, kid, PIP_KEEPER);
    clock = new Date('2026-10-03T12:00:00Z');
    expect(await saveKeeper(server, kid, CLOVER_KEEPER)).toEqual(CLOVER_KEEPER);
    expect(await getKeeper(server, kid)).toEqual(CLOVER_KEEPER);
    const rows = await db.select().from(keepers);
    const mine = rows.filter((r) => r.userId === kid.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.createdAt).toEqual(new Date('2026-10-02T12:00:00Z'));
    expect(mine[0]!.updatedAt).toEqual(new Date('2026-10-03T12:00:00Z'));
  });

  it('refuses ids the Keeper data does not have (VALIDATION_FAILED, kid-readable)', async () => {
    const server = await start();
    const kid = await player();
    for (const bad of [
      { ...PIP_KEEPER, base: 'robot' },
      { ...PIP_KEEPER, hairColor: 'plaid' },
      { ...PIP_KEEPER, eyeColor: 'laser' },
      { ...PIP_KEEPER, outfit: 'armor' },
    ]) {
      const res = await call(server, 'POST', '/keeper', kid, bad);
      expect(res.statusCode).toBe(400);
      const error = errorOf(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.message).toMatch(/^We don't know that/);
    }
    expect(await getKeeper(server, kid)).toBeNull();
  });

  it('refuses the wrong shape: extra fields, missing fields, non-ids', async () => {
    const server = await start();
    const kid = await player();
    const missing = { base: PIP_KEEPER.base, hairColor: PIP_KEEPER.hairColor, eyeColor: 'sky' };
    for (const bad of [{ ...PIP_KEEPER, hat: 'crown' }, missing, { ...PIP_KEEPER, base: '<b>' }]) {
      const res = await call(server, 'POST', '/keeper', kid, bad);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    expect(await getKeeper(server, kid)).toBeNull();
  });

  it('rate limits saving per player', async () => {
    const server = await start();
    const kid = await player();
    const { max } = KEEPER_RATE_LIMITS.save.perUser;
    for (let i = 0; i < max; i++) await saveKeeper(server, kid, PIP_KEEPER);
    const res = await call(server, 'POST', '/keeper', kid, PIP_KEEPER);
    expect(errorOf(res).code).toBe('RATE_LIMITED');
  });

  describe('map gate (HP_KEEPER_REQUIRED)', () => {
    it('is on by default: no making or joining a patch without a Keeper', async () => {
      const server = await start();
      const kid = await player();
      const made = await newMap(server, kid);
      expect(made.statusCode).toBe(403);
      expect(errorOf(made)).toEqual({
        code: 'FORBIDDEN',
        message: 'Pick your Keeper first, then come back!',
      });
      const joined = await call(server, 'POST', '/maps/join', kid, { code: 'ABCD-EFGH' });
      expect(errorOf(joined).message).toBe('Pick your Keeper first, then come back!');

      await saveKeeper(server, kid, PIP_KEEPER);
      expect((await newMap(server, kid)).statusCode).toBe(201);
    });

    it('lets players without a Keeper in when switched off', async () => {
      const server = await start({ HP_KEEPER_REQUIRED: 'false' });
      expect((await newMap(server, await player())).statusCode).toBe(201);
    });
  });

  it('shows each member’s Keeper on the map, and the change after a refetch', async () => {
    const server = await start({ HP_KEEPER_REQUIRED: 'false' });
    const owner = await player();
    await saveKeeper(server, owner, PIP_KEEPER);
    const made = await newMap(server, owner);
    const { map } = MapResponseSchema.parse(made.json());
    expect(map.members.map((m) => m.keeper)).toEqual([PIP_KEEPER]);

    // A member who never picked one (gate off) shows as null, not a guess.
    const other = await player();
    const join = await call(server, 'POST', '/maps/join', other, { code: map.admin!.invite!.code });
    const requestId = JoinMapResponseSchema.parse(join.json()).request.id;
    await call(server, 'POST', `/maps/${map.id}/requests/${requestId}/approve`, owner);

    await saveKeeper(server, owner, CLOVER_KEEPER);
    const res = await call(server, 'GET', `/maps/${map.id}/view`, other);
    const view = MapViewSchema.parse(res.json());
    expect(view.members.map((m) => [m.user.id, m.keeper])).toEqual([
      [owner.id, CLOVER_KEEPER],
      [other.id, null],
    ]);
  });
});
