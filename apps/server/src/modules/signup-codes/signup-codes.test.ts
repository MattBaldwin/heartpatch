import {
  ApiErrorSchema,
  CreateSignupCodeResponseSchema,
  JoinMapResponseSchema,
  MAP_MAX_PLAYERS,
  MapResponseSchema,
  MyMapsResponseSchema,
  MySignupCodesResponseSchema,
  RecoveryCodeResponseSchema,
  SIGNUP_CODE_LENGTH,
  normalizeSignupCode,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { AUTH_RATE_LIMITS, SESSION_COOKIE } from '../auth/limits.js';
import { createAuthRepo } from '../auth/repo.js';
import { newSessionToken } from '../auth/secrets.js';
import { createAuthService } from '../auth/service.js';
import type * as Secrets from '../auth/secrets.js';
import { INVITE_CODE_TTL_MS } from '../maps/limits.js';
import { SIGNUP_CODE_RATE_LIMITS, SIGNUP_CODE_RULES } from './limits.js';
import { createSignupCodesService, hashSignupCode } from './service.js';

// Cheap stand-in for Argon2 (see auth.test.ts): these tests are about codes.
vi.mock('../auth/secrets.js', async (importOriginal) =>
  (await import('../../../tests/fake-secrets.js')).fakeSecrets(
    await importOriginal<typeof Secrets>(),
  ),
);

const url = inject('testDatabaseUrl');
const BOOTSTRAP = 'bootstrap-code-for-tests';
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };

const MESSAGES = {
  badCode: "Hmm, that code doesn't work. Check it with a grown-up!",
  expired: 'That code is too old now. Ask a grown-up for a new one!',
  usedUp: 'That code is all used up! Ask a grown-up for a new one.',
  revoked: 'That code was turned off. Ask a grown-up for a new one!',
  patchFull: 'That patch is full! Ask a grown-up for a family code instead.',
};

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('family signup codes (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date();
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date();
  });

  /** An empty `HP_DEV_SIGNUP_LIMIT_PER_IP` keeps the real per-IP signup limit. */
  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: BOOTSTRAP,
      // Most tests sign up many families from one IP; the limit has its own test.
      ...(env['HP_DEV_SIGNUP_LIMIT_PER_IP'] === '' ? {} : { HP_DEV_SIGNUP_LIMIT_PER_IP: '500' }),
      ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')),
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  const newName = () => `codekid_${String((counter += 1))}`;

  /** A logged-in player with a Keeper, written straight to the database. */
  async function player(options: { tutorialDone?: boolean } = {}): Promise<Player> {
    const username = newName();
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
        tutorialCompletedAt: options.tutorialDone ? new Date() : null,
      })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
    extra: Record<string, unknown> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
      ...extra,
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function owner(
    server: FastifyInstance,
  ): Promise<Player & { mapId: string; invite: string }> {
    const who = await player();
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Pumpkin Hollow',
      timeZone: 'America/Chicago',
    });
    expect(res.statusCode).toBe(201);
    const { map } = MapResponseSchema.parse(res.json());
    return { ...who, mapId: map.id, invite: map.admin!.invite!.code };
  }

  async function makeCode(server: FastifyInstance, who: Player, label = 'Smith family') {
    const res = await call(server, 'POST', '/signup-codes', who, { label });
    expect(res.statusCode).toBe(201);
    return CreateSignupCodeResponseSchema.parse(res.json());
  }

  async function myCodes(server: FastifyInstance, who: Player) {
    const res = await call(server, 'GET', '/signup-codes', who);
    expect(res.statusCode).toBe(200);
    return MySignupCodesResponseSchema.parse(res.json());
  }

  const signupBody = (signupCode: string, username = newName()) => ({
    signupCode,
    username,
    password: 'squishy-secret',
    birthYear: 2014,
    timeZone: 'America/Chicago',
  });

  const signup = (server: FastifyInstance, signupCode: string, username?: string, extra = {}) =>
    call(server, 'POST', '/auth/signup', null, signupBody(signupCode, username), extra);

  async function signedUp(server: FastifyInstance, signupCode: string) {
    const res = await signup(server, signupCode);
    expect(res.statusCode).toBe(201);
    const { user } = RecoveryCodeResponseSchema.parse(res.json());
    const token = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    return { ...user, token };
  }

  const userRow = (id: string) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) });
  const codeRow = (id: string) =>
    db.query.signupCodes.findFirst({ where: (c, { eq }) => eq(c.id, id) });

  describe('making codes', () => {
    it('lets a patch owner make a labelled code, shown once and stored hashed', async () => {
      const server = await start();
      const me = await owner(server);
      const res = await call(server, 'POST', '/signup-codes', me, { label: ' Lee family ' });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const { code, signupCode } = CreateSignupCodeResponseSchema.parse(res.json());
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(normalizeSignupCode(code)).toHaveLength(SIGNUP_CODE_LENGTH);
      expect(signupCode).toMatchObject({
        label: 'Lee family',
        status: 'live',
        uses: 0,
        maxUses: SIGNUP_CODE_RULES.defaultMaxUses,
        usedBy: [],
      });
      expect(new Date(signupCode.expiresAt).getTime()).toBe(
        clock.getTime() + SIGNUP_CODE_RULES.ttlMs,
      );

      const row = await codeRow(signupCode.id);
      expect(row?.codeHash).toBe(hashSignupCode(code));
      expect(row?.codeHash).not.toContain(normalizeSignupCode(code));
      expect(row?.createdByUserId).toBe(me.id);

      const mine = await myCodes(server, me);
      expect(mine.liveMax).toBe(SIGNUP_CODE_RULES.ownerLiveMax);
      expect(mine.codes.map((c) => c.id)).toEqual([signupCode.id]);
      expect(JSON.stringify(mine)).not.toContain(normalizeSignupCode(code).slice(0, 8));
    });

    it('needs a patch of your own, and a kind label', async () => {
      const server = await start();
      const noPatch = await player();
      const res = await call(server, 'POST', '/signup-codes', noPatch, { label: 'Cousins' });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toBe('Make a patch first, then you can make family codes!');

      const me = await owner(server);
      const rude = await call(server, 'POST', '/signup-codes', me, { label: 'sh1thead' });
      expect(rude.statusCode).toBe(400);
      const empty = await call(server, 'POST', '/signup-codes', me, { label: '  ' });
      expect(empty.statusCode).toBe(400);
      expect((await call(server, 'GET', '/signup-codes', null)).statusCode).toBe(401);
    });

    it('caps an owner at 3 live codes, even with taps racing', async () => {
      const server = await start();
      const me = await owner(server);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          call(server, 'POST', '/signup-codes', me, { label: `Family ${String(i)}` }),
        ),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(
        SIGNUP_CODE_RULES.ownerLiveMax,
      );
      const refused = results.find((r) => r.statusCode !== 201)!;
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).message).toBe(
        'You have 3 family codes. Turn one off to make another!',
      );

      // Turning one off makes room; ended codes stay listed.
      const { codes } = await myCodes(server, me);
      const off = await call(server, 'POST', `/signup-codes/${codes[0]!.id}/revoke`, me);
      expect(off.statusCode).toBe(204);
      await makeCode(server, me, 'Lee family');
      const after = await myCodes(server, me);
      expect(after.codes.map((c) => c.status)).toEqual(['live', 'live', 'live', 'revoked']);
    });

    it('only lets the maker turn a code off, and turning it off twice is fine', async () => {
      const server = await start();
      const me = await owner(server);
      const other = await owner(server);
      const { signupCode } = await makeCode(server, me);
      const path = `/signup-codes/${signupCode.id}/revoke`;

      const notYours = await call(server, 'POST', path, other);
      expect(notYours.statusCode).toBe(404);
      expect(errorOf(notYours).message).toBe("We couldn't find that code.");
      expect((await codeRow(signupCode.id))?.revokedAt).toBeNull();

      expect((await call(server, 'POST', path, me)).statusCode).toBe(204);
      expect((await call(server, 'POST', path, me)).statusCode).toBe(204);
      const missing = `/signup-codes/${crypto.randomUUID()}/revoke`;
      expect((await call(server, 'POST', missing, me)).statusCode).toBe(404);
    });

    it('rate limits making codes per player', async () => {
      const server = await start();
      const me = await owner(server);
      const { max } = SIGNUP_CODE_RATE_LIMITS.create.perUser;
      for (let i = 0; i < max; i += 1) {
        const res = await call(server, 'POST', '/signup-codes', me, { label: `Try ${String(i)}` });
        expect([201, 409]).toContain(res.statusCode);
      }
      const limited = await call(server, 'POST', '/signup-codes', me, { label: 'One more' });
      expect(limited.statusCode).toBe(429);
    });
  });

  describe('signing up with a family code', () => {
    it('makes the account, counts the use and records who brought them', async () => {
      const server = await start();
      const me = await owner(server);
      const { code, signupCode } = await makeCode(server, me);

      // Typed loosely: lower case, spaces instead of dashes.
      const kid = await signedUp(server, code.toLowerCase().replaceAll('-', ' '));
      const row = await userRow(kid.id);
      expect(row?.signupCodeId).toBe(signupCode.id);
      expect(row?.invitedBy).toBe(me.id);

      const [listed] = (await myCodes(server, me)).codes;
      expect(listed).toMatchObject({ uses: 1, status: 'live', usedBy: [kid.username] });
    });

    it('says when a code is too old, used up, turned off or wrong', async () => {
      const server = await start();
      const me = await owner(server);
      const service = createSignupCodesService({
        db,
        bootstrapCode: undefined,
        clock: () => clock,
      });

      const old = await makeCode(server, me, 'Old');
      const once = await service.operatorCreate({ label: 'Once', maxUses: 1 });
      const off = await makeCode(server, me, 'Off');
      await signedUp(server, once.code);
      expect(
        (await call(server, 'POST', `/signup-codes/${off.signupCode.id}/revoke`, me)).statusCode,
      ).toBe(204);
      clock = new Date(clock.getTime() + SIGNUP_CODE_RULES.ttlMs + 1000);

      for (const [code, message] of [
        [old.code, MESSAGES.expired],
        [once.code, MESSAGES.usedUp],
        [off.code, MESSAGES.revoked],
        ['ABCD-EFGH-JKMN', MESSAGES.badCode],
        ['not-a-code', MESSAGES.badCode],
      ] as const) {
        const res = await signup(server, code);
        expect(res.statusCode).toBe(403);
        expect(errorOf(res)).toEqual({ code: 'FORBIDDEN', message });
      }
    });

    it('never goes over max uses when families sign up at the same moment', async () => {
      const server = await start();
      const service = createSignupCodesService({
        db,
        bootstrapCode: undefined,
        clock: () => clock,
      });
      const { code, signupCode } = await service.operatorCreate({ label: 'Busy', maxUses: 3 });

      const results = await Promise.all(Array.from({ length: 8 }, () => signup(server, code)));
      const made = results.filter((r) => r.statusCode === 201);
      expect(made).toHaveLength(3);
      for (const r of results.filter((x) => x.statusCode !== 201)) {
        expect(errorOf(r).message).toBe(MESSAGES.usedUp);
      }
      expect((await codeRow(signupCode.id))?.useCount).toBe(3);
      const signedUpWithIt = await db.query.users.findMany({
        where: (u, { eq }) => eq(u.signupCodeId, signupCode.id),
      });
      expect(signedUpWithIt).toHaveLength(3);
    });

    it("doesn't spend a use when the name is taken", async () => {
      const server = await start();
      const service = createSignupCodesService({
        db,
        bootstrapCode: undefined,
        clock: () => clock,
      });
      const { code, signupCode } = await service.operatorCreate({ label: 'Twins', maxUses: 2 });
      const res = await signup(server, code, 'TwinOne');
      expect(res.statusCode).toBe(201);
      const again = await signup(server, code, 'twinone');
      expect(again.statusCode).toBe(409);
      expect((await codeRow(signupCode.id))?.useCount).toBe(1);
    });

    it("leaves accounts made with a code alone when it's turned off", async () => {
      const server = await start();
      const me = await owner(server);
      const { code, signupCode } = await makeCode(server, me);
      const kid = await signedUp(server, code);
      await call(server, 'POST', `/signup-codes/${signupCode.id}/revoke`, me);

      const res = await call(server, 'GET', '/me', { ...kid, username: kid.username });
      expect(res.json()).toMatchObject({ user: { id: kid.id } });
      expect((await userRow(kid.id))?.signupCodeId).toBe(signupCode.id);
    });

    it('rate limits code guesses per IP', async () => {
      const server = await start({ HP_DEV_SIGNUP_LIMIT_PER_IP: '' });
      const { max } = AUTH_RATE_LIMITS.signup.perIp;
      for (let i = 0; i < max; i += 1) {
        const guess = `ABCD-EFGH-${'JKMNPQRSTV'.charAt(i % 10)}${String((i % 8) + 2)}`;
        expect((await signup(server, guess)).statusCode).toBe(403);
      }
      const limited = await signup(server, BOOTSTRAP);
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).code).toBe('RATE_LIMITED');
    });

    it('still takes HP_SIGNUP_CODE for one release, with no attribution', async () => {
      const server = await start();
      const kid = await signedUp(server, BOOTSTRAP);
      const row = await userRow(kid.id);
      expect(row?.signupCodeId).toBeNull();
      expect(row?.invitedBy).toBeNull();
    });
  });

  describe('signing up with a patch invite', () => {
    it('makes the account and asks to join that patch in one step', async () => {
      const server = await start();
      const me = await owner(server);
      const kid = await signedUp(server, me.invite.toLowerCase());
      expect((await userRow(kid.id))?.invitedBy).toBe(me.id);

      const mine = await call(server, 'GET', '/maps', { ...kid, username: kid.username });
      const { requests } = MyMapsResponseSchema.parse(mine.json());
      expect(requests).toMatchObject([{ mapName: 'Pumpkin Hollow', owner: { id: me.id } }]);

      // The owner sees the request; saying yes waits until they've picked a Keeper.
      const detail = MapResponseSchema.parse(
        (await call(server, 'GET', `/maps/${me.mapId}`, me)).json(),
      ).map;
      const request = detail.admin!.requests.find((r) => r.user.id === kid.id)!;
      const approvePath = `/maps/${me.mapId}/requests/${request.id}/approve`;
      const early = await call(server, 'POST', approvePath, me);
      expect(early.statusCode).toBe(409);
      expect(errorOf(early).message).toBe(
        `${kid.username} is still getting ready. Try again soon!`,
      );

      await db.insert(keepers).values({ userId: kid.id, ...TEST_KEEPER });
      expect((await call(server, 'POST', approvePath, me)).statusCode).toBe(204);
    });

    it('also waits for the tutorial where it is required', async () => {
      const server = await start({ HP_TUTORIAL_REQUIRED: 'true' });
      const me = await player({ tutorialDone: true });
      const res = await call(server, 'POST', '/maps', me, {
        name: 'Glade Pals',
        timeZone: 'America/Chicago',
      });
      const { map } = MapResponseSchema.parse(res.json());
      const kid = await signedUp(server, map.admin!.invite!.code);
      await db.insert(keepers).values({ userId: kid.id, ...TEST_KEEPER });

      const detail = MapResponseSchema.parse(
        (await call(server, 'GET', `/maps/${map.id}`, me)).json(),
      ).map;
      const request = detail.admin!.requests.find((r) => r.user.id === kid.id)!;
      const early = await call(
        server,
        'POST',
        `/maps/${map.id}/requests/${request.id}/approve`,
        me,
      );
      expect(early.statusCode).toBe(409);
      expect(errorOf(early).message).toMatch(/still getting ready/);
    });

    it('says when the invite is old, turned off, or the patch is full, and makes no account', async () => {
      const server = await start();
      const expired = await owner(server);
      // A week and a bit later: the first patch's invite is too old.
      clock = new Date(clock.getTime() + INVITE_CODE_TTL_MS + 1000);
      const revoked = await owner(server);
      await call(server, 'POST', `/maps/${revoked.mapId}/invite/revoke`, revoked);
      const full = await owner(server);
      for (let seat = 1; seat < MAP_MAX_PLAYERS; seat += 1) {
        const friend = await player();
        const asked = await call(server, 'POST', '/maps/join', friend, { code: full.invite });
        const { request } = JoinMapResponseSchema.parse(asked.json());
        const yes = `/maps/${full.mapId}/requests/${request.id}/approve`;
        expect((await call(server, 'POST', yes, full)).statusCode).toBe(204);
      }

      for (const [code, status, message] of [
        [expired.invite, 403, MESSAGES.expired],
        [revoked.invite, 403, MESSAGES.revoked],
        [full.invite, 409, MESSAGES.patchFull],
        ['WXYZ-2345', 403, MESSAGES.badCode],
      ] as const) {
        const username = newName();
        const res = await signup(server, code, username);
        expect(res.statusCode).toBe(status);
        expect(errorOf(res).message).toBe(message);
        const made = await db.query.users.findFirst({
          where: (u, { eq }) => eq(u.username, username),
        });
        expect(made).toBeUndefined();
      }
    });
  });

  describe('a code that stops working mid-sign-up', () => {
    it('rolls the account back when the invite is turned off after the check', async () => {
      const server = await start();
      const me = await owner(server);
      const passes = createSignupCodesService({ db, bootstrapCode: undefined, clock: () => clock });
      const auth = createAuthService({
        repo: createAuthRepo(db),
        now: () => clock,
        passes: {
          check: passes.check,
          // The owner turns the invite off between the check and the account's transaction.
          redeem: async (tx, pass, userId) => {
            const off = await call(server, 'POST', `/maps/${me.mapId}/invite/revoke`, me);
            expect(off.statusCode).toBe(204);
            return passes.redeem(tx, pass, userId);
          },
        },
      });
      const username = newName();
      await expect(
        auth.signup({ ...signupBody(me.invite, username), signupCode: me.invite }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: MESSAGES.revoked });
      const made = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.username, username),
      });
      expect(made).toBeUndefined();
    });
  });

  describe('operator codes', () => {
    it('makes uncapped codes, lists every code and turns any off', async () => {
      const server = await start();
      const me = await owner(server);
      const mine = await makeCode(server, me, 'Owner made');
      const service = createSignupCodesService({
        db,
        bootstrapCode: undefined,
        clock: () => clock,
      });
      const made = await Promise.all(
        Array.from({ length: SIGNUP_CODE_RULES.ownerLiveMax + 1 }, (_, i) =>
          service.operatorCreate({ label: `Op ${String(i)}`, maxUses: 20, ttlMs: 30 * DAY_MS }),
        ),
      );
      expect(made.map((m) => m.signupCode.maxUses)).toEqual([20, 20, 20, 20]);
      const kid = await signedUp(server, made[0]!.code);
      expect((await userRow(kid.id))?.invitedBy).toBeNull();

      const all = await service.operatorList();
      expect(all.find((c) => c.id === mine.signupCode.id)?.createdBy).toBe(me.username);
      expect(all.find((c) => c.id === made[0]!.signupCode.id)).toMatchObject({
        createdBy: null,
        uses: 1,
        usedBy: [kid.username],
      });

      expect(await service.operatorRevoke(mine.signupCode.id)).toBe(true);
      expect(await service.operatorRevoke(mine.signupCode.id)).toBe(false);
      expect((await signup(server, mine.code)).statusCode).toBe(403);
    });
  });
});
