import { ApiErrorSchema } from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { AUTH_RATE_LIMITS } from './limits.js';
import type * as Secrets from './secrets.js';

// The limits count attempts, not hashing work, so Argon2 is swapped for a
// cheap stand-in (tests/fake-secrets.ts). With the real thing (64 MiB, four
// lanes, every attempt) the per-IP login test alone was 30 full-cost checks,
// which blew its timeout whenever other test files were hashing too.
vi.mock('./secrets.js', async (importOriginal) =>
  (await import('../../../tests/fake-secrets.js')).fakeSecrets(
    await importOriginal<typeof Secrets>(),
  ),
);

const url = inject('testDatabaseUrl');
const SIGNUP_CODE = 'family-code-for-tests';
const HEADERS = { 'x-requested-with': 'heartpatch' };

describe.skipIf(!url)('auth rate limits (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let counter = 0;
  /**
   * The clock the rate-limit windows run on (`@fastify/rate-limit` reads
   * `Date.now()`): faked, so a window only moves when a test moves it, and
   * the tests never depend on how long they took.
   */
  const startedAt = new Date('2026-10-05T12:00:00Z');

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.useRealTimers();
  });

  /** A fresh app: fresh counters for every limit, so tests never share state. */
  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    vi.useFakeTimers({ toFake: ['Date'], now: startedAt });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: SIGNUP_CODE,
      ...env,
    });
    app = await buildApp({ config, db, clock: () => new Date(), logger: false });
    return app;
  }

  const newName = () => `ratekid_${String((counter += 1))}`; // a fresh database per run

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

  function errorOf(res: LightMyRequestResponse) {
    return ApiErrorSchema.parse(res.json()).error;
  }

  async function signup(server: FastifyInstance) {
    const body = signupBody();
    const res = await post(server, '/auth/signup', body);
    expect(res.statusCode).toBe(201);
    return body;
  }

  describe('signup', () => {
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

    it('takes a raised per-IP signup limit from dev config (e2e)', async () => {
      const server = await start({ HP_DEV_SIGNUP_LIMIT_PER_IP: '50' });
      const { max } = AUTH_RATE_LIMITS.signup.perIp;
      for (let i = 0; i <= max; i += 1) {
        expect((await post(server, '/auth/signup', signupBody())).statusCode).toBe(201);
      }
    });
  });

  describe('login', () => {
    it('rate limits wrong passwords per username, even from new IPs', async () => {
      const server = await start();
      const body = await signup(server);
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
        username: other.username,
        password: other.password,
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

    it('lifts the lock once the window has passed', async () => {
      const server = await start();
      const body = await signup(server);
      const { max, windowMs } = AUTH_RATE_LIMITS.login.perUsername;
      for (let i = 0; i < max; i += 1) {
        await post(server, '/auth/login', { username: body.username, password: 'wrong' });
      }
      const right = { username: body.username, password: body.password };
      const limited = await post(server, '/auth/login', right);
      expect(limited.statusCode).toBe(429);
      const retryAfter = Number(limited.headers['retry-after']);
      expect(retryAfter * 1000).toBeLessThanOrEqual(windowMs);

      // A second before the window ends: still locked (and the window hasn't moved).
      vi.setSystemTime(startedAt.getTime() + windowMs - 1000);
      expect((await post(server, '/auth/login', right)).statusCode).toBe(429);
      // Past it: the right password works again.
      vi.setSystemTime(startedAt.getTime() + windowMs);
      expect((await post(server, '/auth/login', right)).statusCode).toBe(200);
    });
  });

  describe('recovery', () => {
    it('rejects a wrong code and rate limits guesses per username', async () => {
      const server = await start();
      const body = await signup(server);
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
});
