import {
  ApiErrorSchema,
  MeResponseSchema,
  RecoveryCodeResponseSchema,
  SessionResponseSchema,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { AUTH_RATE_LIMITS, SESSION_COOKIE, SESSION_TTL_MS } from './limits.js';
import { createAuthRepo } from './repo.js';
import { createAuthService } from './service.js';

const url = inject('testDatabaseUrl');
const SIGNUP_CODE = 'family-code-for-tests';
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!url)('auth endpoints (needs DATABASE_URL)', () => {
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

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: SIGNUP_CODE,
      ...env,
    });
    app = await buildApp({
      config,
      db,
      clock: () => clock,
      logger: false,
    });
    return app;
  }

  const newName = () => `authkid_${String((counter += 1))}`;

  const signupBody = (overrides: Record<string, unknown> = {}) => ({
    signupCode: SIGNUP_CODE,
    username: newName(),
    password: 'squishy-secret',
    birthYear: 2014,
    timeZone: 'America/Chicago',
    ...overrides,
  });

  function post(server: FastifyInstance, path: string, payload: unknown, extra = {}) {
    return server.inject({
      method: 'POST',
      url: `/api/v1${path}`,
      headers: HEADERS,
      payload: payload as object,
      ...extra,
    });
  }

  function sessionCookie(res: LightMyRequestResponse) {
    return res.cookies.find((c) => c.name === SESSION_COOKIE);
  }

  async function me(server: FastifyInstance, token: string | undefined) {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/me',
      ...(token ? { cookies: { [SESSION_COOKIE]: token } } : {}),
    });
    expect(res.statusCode).toBe(200);
    return { res, user: MeResponseSchema.parse(res.json()).user };
  }

  // Reads use the relational query API: only repos import drizzle-orm (lint rule).
  const userRow = (id: string) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) });
  const sessionRows = (userId: string) =>
    db.query.sessions.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
  const codeRows = (userId: string) =>
    db.query.recoveryCodes.findMany({ where: (t, { eq }) => eq(t.userId, userId) });

  function errorOf(res: LightMyRequestResponse) {
    return ApiErrorSchema.parse(res.json()).error;
  }

  async function signup(server: FastifyInstance, overrides: Record<string, unknown> = {}) {
    const body = signupBody(overrides);
    const res = await post(server, '/auth/signup', body);
    expect(res.statusCode).toBe(201);
    const parsed = RecoveryCodeResponseSchema.parse(res.json());
    return { body, ...parsed, token: sessionCookie(res)!.value };
  }

  describe('signup', () => {
    it('creates the account, logs in and shows a recovery code once', async () => {
      const server = await start();
      const body = signupBody({ username: 'Pumpkin_Pal' });
      const res = await post(server, '/auth/signup', body);

      expect(res.statusCode).toBe(201);
      const { user, recoveryCode } = RecoveryCodeResponseSchema.parse(res.json());
      expect(user.username).toBe('Pumpkin_Pal');
      expect(recoveryCode).toMatch(
        /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/,
      );
      expect(res.body).not.toMatch(/hash/i);

      const cookie = sessionCookie(res)!;
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe('Lax');
      expect(cookie['path']).toBe('/');
      expect(cookie.secure).toBeFalsy(); // Secure only in production
      expect((await me(server, cookie.value)).user).toEqual(user);

      const row = await userRow(user.id);
      expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(row?.timeZone).toBe('America/Chicago');
      expect(row?.birthYear).toBe(2014);
      const userSessions = await sessionRows(user.id);
      expect(userSessions).toHaveLength(1);
      expect(userSessions[0]?.tokenHash).not.toBe(cookie.value);
      const codes = await codeRows(user.id);
      expect(codes).toHaveLength(1);
      expect(codes[0]?.codeHash).toMatch(/^\$argon2id\$/);
    });

    it('sets Secure cookies in production', async () => {
      const server = await start({ NODE_ENV: 'production' });
      const res = await post(server, '/auth/signup', signupBody());
      expect(res.statusCode).toBe(201);
      expect(sessionCookie(res)?.secure).toBe(true);
    });

    it('requires the X-Requested-With header', async () => {
      const server = await start();
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: signupBody(),
      });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    });

    it('requires the family signup code', async () => {
      const server = await start();
      const res = await post(server, '/auth/signup', signupBody({ signupCode: 'guess-guess' }));
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toMatch(/family code/);
    });

    it('is closed when no signup code is configured', async () => {
      const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
      app = await buildApp({ config, db });
      const res = await post(app, '/auth/signup', signupBody());
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toMatch(/closed/);
    });

    it('rejects a taken username, ignoring case', async () => {
      const server = await start();
      await signup(server, { username: 'MuffinMoth' });
      const res = await post(server, '/auth/signup', signupBody({ username: 'muffinmoth' }));
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toEqual({
        code: 'CONFLICT',
        message: 'Someone already picked that name. Try another one!',
      });
    });

    it('rejects inappropriate and identifying usernames', async () => {
      const server = await start();
      for (const [username, pattern] of [
        ['sh1thead', /kinder name/],
        ['b_i_t_c_h', /kinder name/],
        ['call_5551234567', /phone numbers/],
      ] as const) {
        const res = await post(server, '/auth/signup', signupBody({ username }));
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).code).toBe('VALIDATION_FAILED');
        expect(errorOf(res).message).toMatch(pattern);
      }
      const stored = await db.query.users.findFirst({
        where: (u, { eq, sql }) => eq(sql`lower(${u.username})`, 'sh1thead'),
      });
      expect(stored).toBeUndefined();
    });

    it('validates birth year and time zone on the server', async () => {
      const server = await start();
      const nextYear = clock.getUTCFullYear() + 1;
      for (const overrides of [
        { birthYear: nextYear },
        { timeZone: 'Mars/Olympus_Mons' },
        { timeZone: '+05:00' },
      ]) {
        const res = await post(server, '/auth/signup', signupBody(overrides));
        expect(res.statusCode).toBe(400);
      }
      // Aliases are stored under their canonical name.
      const { user } = await signup(server, { timeZone: 'US/Eastern' });
      const row = await userRow(user.id);
      expect(['America/New_York', 'US/Eastern']).toContain(row?.timeZone);
    });

    it('rate limits guessing the family code per IP', async () => {
      const server = await start();
      const { max } = AUTH_RATE_LIMITS.signup.perIp;
      for (let i = 0; i < max; i += 1) {
        const res = await post(server, '/auth/signup', signupBody({ signupCode: `guess-${i}` }));
        expect(res.statusCode).toBe(403);
      }
      const limited = await post(server, '/auth/signup', signupBody());
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      const otherIp = await post(server, '/auth/signup', signupBody(), {
        remoteAddress: '203.0.113.9',
      });
      expect(otherIp.statusCode).toBe(201);
    });
  });

  describe('login and logout', () => {
    it('logs out, then logs back in', async () => {
      const server = await start();
      const { body, user, token } = await signup(server);

      const out = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: HEADERS,
        cookies: { [SESSION_COOKIE]: token },
      });
      expect(out.statusCode).toBe(204);
      expect(sessionCookie(out)?.value).toBe('');
      expect((await me(server, token)).user).toBeNull();

      const res = await post(server, '/auth/login', {
        username: body.username.toUpperCase(),
        password: body.password,
      });
      expect(res.statusCode).toBe(200);
      expect(SessionResponseSchema.parse(res.json()).user).toEqual(user);
      expect((await me(server, sessionCookie(res)!.value)).user).toEqual(user);
    });

    it('gives the same answer for a wrong password and an unknown user', async () => {
      const server = await start();
      const { body } = await signup(server);
      const wrong = await post(server, '/auth/login', {
        username: body.username,
        password: 'nope',
      });
      const unknown = await post(server, '/auth/login', {
        username: 'nobody_here',
        password: 'nope',
      });
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(errorOf(wrong)).toEqual(errorOf(unknown));
      expect(sessionCookie(wrong)).toBeUndefined();
    });

    it('treats a non-Argon2 stored hash (seed users) as a wrong password', async () => {
      const server = await start();
      const username = newName();
      await db.insert(users).values({ username, passwordHash: 'not-a-hash', birthYear: 2014 });
      const res = await post(server, '/auth/login', { username, password: 'not-a-hash' });
      expect(res.statusCode).toBe(401);
    });

    it('rate limits wrong passwords per username, even from new IPs', async () => {
      const server = await start();
      const { body } = await signup(server);
      const { max } = AUTH_RATE_LIMITS.login.perUsername;
      for (let i = 0; i < max; i += 1) {
        const res = await post(
          server,
          '/auth/login',
          { username: body.username, password: `wrong-${i}` },
          { remoteAddress: `198.51.100.${i + 1}` },
        );
        expect(res.statusCode).toBe(401);
      }
      // Locked for now, even with the right password.
      const limited = await post(server, '/auth/login', {
        username: body.username,
        password: body.password,
      });
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).message).toMatch(/break/);

      // Other players aren't affected.
      const other = await signup(server);
      const ok = await post(server, '/auth/login', {
        username: other.body.username,
        password: other.body.password,
      });
      expect(ok.statusCode).toBe(200);
    });

    it('rate limits login attempts per IP across usernames', async () => {
      const server = await start();
      const { max } = AUTH_RATE_LIMITS.login.perIp;
      const attempts = Array.from({ length: max }, (_, i) =>
        post(server, '/auth/login', { username: `nobody_${i}`, password: 'nope' }),
      );
      for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(401);
      const limited = await post(server, '/auth/login', { username: 'nobody_x', password: 'x' });
      expect(limited.statusCode).toBe(429);
    });
  });

  describe('sessions', () => {
    it('rolls the expiry forward once a day and expires idle sessions', async () => {
      const server = await start();
      const { user, token } = await signup(server);
      const expiryOf = async () => (await sessionRows(user.id))[0]!.expiresAt.getTime();
      const firstExpiry = await expiryOf();

      // Same day: no write, no new cookie.
      const sameDay = await me(server, token);
      expect(sessionCookie(sameDay.res)).toBeUndefined();
      expect(await expiryOf()).toBe(firstExpiry);

      // Two days later: renewed for another 30 days.
      clock = new Date(clock.getTime() + 2 * DAY_MS);
      const later = await me(server, token);
      expect(later.user).toEqual(user);
      expect(sessionCookie(later.res)?.value).toBe(token);
      expect(await expiryOf()).toBe(clock.getTime() + SESSION_TTL_MS);

      // Idle past the expiry: logged out.
      clock = new Date(clock.getTime() + SESSION_TTL_MS + 1000);
      expect((await me(server, token)).user).toBeNull();
    });

    it('ignores unknown tokens and clears the dead cookie', async () => {
      const server = await start();
      const dead = await me(server, 'made-up-token');
      expect(dead.user).toBeNull();
      expect(sessionCookie(dead.res)?.value).toBe('');
      expect((await me(server, undefined)).user).toBeNull();
    });
  });

  describe('recovery', () => {
    it('resets the password, revokes every session and rotates the code', async () => {
      const server = await start();
      const { body, user, token, recoveryCode } = await signup(server);
      const otherDevice = await post(server, '/auth/login', {
        username: body.username,
        password: body.password,
      });
      const otherToken = sessionCookie(otherDevice)!.value;

      const res = await post(server, '/auth/recover', {
        username: body.username,
        recoveryCode: recoveryCode.toLowerCase().replaceAll('-', ' '),
        newPassword: 'brand-new-secret',
      });
      expect(res.statusCode).toBe(200);
      const recovered = RecoveryCodeResponseSchema.parse(res.json());
      expect(recovered.user).toEqual(user);
      expect(recovered.recoveryCode).not.toBe(recoveryCode);

      // Old sessions are gone; this device is logged in.
      expect((await me(server, token)).user).toBeNull();
      expect((await me(server, otherToken)).user).toBeNull();
      expect((await me(server, sessionCookie(res)!.value)).user).toEqual(user);

      // Only the new password works.
      const oldPw = await post(server, '/auth/login', {
        username: body.username,
        password: body.password,
      });
      expect(oldPw.statusCode).toBe(401);
      const newPw = await post(server, '/auth/login', {
        username: body.username,
        password: 'brand-new-secret',
      });
      expect(newPw.statusCode).toBe(200);

      // The old code is used up; the new one is the only active code.
      const reuse = await post(server, '/auth/recover', {
        username: body.username,
        recoveryCode,
        newPassword: 'another-secret',
      });
      expect(reuse.statusCode).toBe(401);
      const codes = await codeRows(user.id);
      expect(codes).toHaveLength(2);
      expect(codes.filter((c) => c.usedAt === null)).toHaveLength(1);

      const again = await post(server, '/auth/recover', {
        username: body.username,
        recoveryCode: recovered.recoveryCode,
        newPassword: 'third-secret!',
      });
      expect(again.statusCode).toBe(200);
    });

    it('lets only one of two simultaneous resets with the same code win', async () => {
      const server = await start();
      const { body, recoveryCode } = await signup(server);
      const attempt = (newPassword: string) =>
        post(server, '/auth/recover', { username: body.username, recoveryCode, newPassword });
      const results = await Promise.all([attempt('first-new-pass'), attempt('second-new-pass')]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    });

    it('rejects a wrong code and rate limits guesses per username', async () => {
      const server = await start();
      const { body } = await signup(server);
      const { max } = AUTH_RATE_LIMITS.recover.perUsername;
      for (let i = 0; i < max; i += 1) {
        const res = await post(
          server,
          '/auth/recover',
          { username: body.username, recoveryCode: 'ABCD-EFGH-JKMN', newPassword: 'new-secret!' },
          { remoteAddress: `192.0.2.${i + 1}` },
        );
        expect(res.statusCode).toBe(401);
        expect(errorOf(res).message).toMatch(/recovery code/);
      }
      const limited = await post(server, '/auth/recover', {
        username: body.username,
        recoveryCode: 'ABCD-EFGH-JKMN',
        newPassword: 'new-secret!',
      });
      expect(limited.statusCode).toBe(429);
    });
  });

  describe('operator reset', () => {
    it('sets a temporary password, revokes sessions and issues a new code', async () => {
      const server = await start();
      const { body, user, token, recoveryCode } = await signup(server);
      const service = createAuthService({ repo: createAuthRepo(db), signupCode: SIGNUP_CODE });

      const result = await service.operatorReset(body.username.toUpperCase());
      expect(result?.user).toEqual(user);
      expect((await me(server, token)).user).toBeNull();

      const login = await post(server, '/auth/login', {
        username: body.username,
        password: result!.temporaryPassword,
      });
      expect(login.statusCode).toBe(200);
      const oldCode = await post(server, '/auth/recover', {
        username: body.username,
        recoveryCode,
        newPassword: 'kid-picked-pw',
      });
      expect(oldCode.statusCode).toBe(401);
      const newCode = await post(server, '/auth/recover', {
        username: body.username,
        recoveryCode: result!.recoveryCode,
        newPassword: 'kid-picked-pw',
      });
      expect(newCode.statusCode).toBe(200);

      expect(await service.operatorReset('nobody_here')).toBeNull();
    });
  });
});
