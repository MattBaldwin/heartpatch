import {
  AdminAuditResponseSchema,
  AdminInviteResponseSchema,
  AdminLookupResponseSchema,
  AdminMeResponseSchema,
  AdminPatchDetailSchema,
  AdminPatchesResponseSchema,
  AdminPlayerDetailSchema,
  AdminPlayersResponseSchema,
  AdminResetPasswordResponseSchema,
  AdminSignupCodesResponseSchema,
  ApiErrorSchema,
  CreateSignupCodeResponseSchema,
  MapResponseSchema,
  RecoveryCodeResponseSchema,
} from '@heartpatch/shared';
import cookie from '@fastify/cookie';
import rateLimitPlugin from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { serializerCompiler, validatorCompiler } from '../../lib/zod.js';
import { adminAudit, adminTotp, keepers, sessions, signupCodes, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { createAuthRepo } from '../auth/repo.js';
import { newSessionToken } from '../auth/secrets.js';
import { createAuthService } from '../auth/service.js';
import type * as Secrets from '../auth/secrets.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { confirmTotp, grantAdmin, hostAudited, revokeAdmin, startTotp } from './grants.js';
import { ADMIN_COOKIE, ADMIN_COOKIE_PATH, ADMIN_RULES } from './limits.js';
import { createAdminRepo } from './repo.js';
import { adminRoutes } from './routes.js';
import type { AdminService } from './service.js';
import { totpCode, totpStep } from './totp.js';

// Cheap stand-in for Argon2 (see auth.test.ts): these tests are about the console.
vi.mock('../auth/secrets.js', async (importOriginal) =>
  (await import('../../../tests/fake-secrets.js')).fakeSecrets(
    await importOriginal<typeof Secrets>(),
  ),
);

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'grown-up-password';
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const ZERO = '00000000-0000-4000-8000-000000000000';

interface Player {
  id: string;
  username: string;
  token: string;
}

interface Admin extends Player {
  secret: string;
}

describe.skipIf(!url)('admin console (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  /** The admin console's clock; moved forward 30 s per sign-in so codes stay fresh. */
  let adminClock = new Date();
  let counter = 0;
  let logLines: string[] = [];

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    adminClock = new Date();
    logLines = [];
  });

  /** The app, logging everything at trace level into `logLines`. */
  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: 'bootstrap-for-admin-tests',
      HP_DEV_SIGNUP_LIMIT_PER_IP: '500',
      HP_DEV_MAP_CREATE_LIMIT_PER_IP: '500',
    });
    app = await buildApp({
      config,
      db,
      adminNow: () => adminClock,
      logger: { level: 'trace', stream: { write: (line: string) => logLines.push(line) } },
    });
    return app;
  }

  const newName = () => `adm_${String(process.pid % 1000)}_${String((counter += 1))}`;
  /** Patch names take letters, numbers and spaces. */
  /**
   * Patch names unique to this run, in letters only: the name filter turns
   * away runs of digits (they could be a phone number).
   */
  const letters = (n: number) =>
    n.toString(26).replace(/./g, (d) => String.fromCharCode(97 + parseInt(d, 26)));
  const patchName = (word: string) => `${word} ${letters(process.pid)} ${letters((counter += 1))}`;

  /** A logged-in player with a Keeper, written straight to the database. */
  async function player(): Promise<Player> {
    const username = newName();
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: `plain:${PASSWORD}`, birthYear: 2014 })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  /** An admin with a confirmed authenticator, through the host-script functions. */
  async function admin(): Promise<Admin> {
    const who = await player();
    expect(await grantAdmin(db, who.username)).toBe('changed');
    const started = await startTotp(db, who.username, () => adminClock);
    const code = totpCode(started!.secret, totpStep(adminClock));
    expect(await confirmTotp(db, who.username, code, () => adminClock)).toBe('enrolled');
    return { ...who, secret: started!.secret };
  }

  const nextCode = (secret: string) => {
    adminClock = new Date(adminClock.getTime() + 30_000);
    return totpCode(secret, totpStep(adminClock));
  };

  function login(server: FastifyInstance, who: Player, password: string, code: string) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      headers: HEADERS,
      payload: { username: who.username, password, code },
    });
  }

  /** Signs in and returns the `hp_admin` cookie value. */
  async function signIn(server: FastifyInstance, who: Admin): Promise<string> {
    const res = await login(server, who, PASSWORD, nextCode(who.secret));
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === ADMIN_COOKIE)!;
    expect(cookie['path']).toBe(ADMIN_COOKIE_PATH);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    return cookie.value;
  }

  function adminCall(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    adminToken: string | null,
    payload?: object,
    playerToken?: string,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: {
        ...(adminToken ? { [ADMIN_COOKIE]: adminToken } : {}),
        ...(playerToken ? { [SESSION_COOKIE]: playerToken } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  }

  function playerCall(
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

  /** A patch with an owner, a member and a player waiting to join. */
  async function patch(server: FastifyInstance, name = 'Moonlit Meadow') {
    const owner = await player();
    const created = await playerCall(server, 'POST', '/maps', owner, {
      name,
      timeZone: 'America/Chicago',
    });
    expect(created.statusCode).toBe(201);
    const { map } = MapResponseSchema.parse(created.json());
    const waiting = await player();
    expect(
      (await playerCall(server, 'POST', '/maps/join', waiting, { code: map.admin!.invite!.code }))
        .statusCode,
    ).toBeLessThan(300);
    return { owner, waiting, mapId: map.id, invite: map.admin!.invite!.code };
  }

  async function auditRows(action: string) {
    return (await db.select().from(adminAudit))
      .filter((r) => r.action === action)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Every admin route but sign-in and sign-out, with a plausible request. */
  const ROUTES: [method: 'GET' | 'POST', path: string, body?: object][] = [
    ['GET', '/admin/me'],
    ['GET', '/admin/patches'],
    ['GET', `/admin/patches/${ZERO}`],
    ['POST', `/admin/patches/${ZERO}/invite/reveal`],
    ['POST', `/admin/patches/${ZERO}/invite`],
    ['POST', `/admin/patches/${ZERO}/requests/${ZERO}/approve`],
    ['POST', `/admin/patches/${ZERO}/requests/${ZERO}/decline`],
    ['GET', '/admin/players'],
    ['GET', `/admin/players/${ZERO}`],
    ['POST', `/admin/players/${ZERO}/reset-password`],
    ['POST', `/admin/players/${ZERO}/logout-everywhere`],
    ['POST', '/admin/lookup', { patch: 'meadow', from: '2026-10-01', to: '2026-10-07' }],
    ['GET', '/admin/signup-codes'],
    ['POST', '/admin/signup-codes', { label: 'Smith family', maxUses: 3, days: 7 }],
    ['POST', `/admin/signup-codes/${ZERO}/extend`, { days: 7 }],
    ['POST', `/admin/signup-codes/${ZERO}/revoke`],
    ['GET', '/admin/audit'],
  ];

  it('lists every admin route in the 403 check, and none grants a role', async () => {
    // Register the admin routes alone and collect what they add.
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);
    await bare.register(cookie);
    await bare.register(rateLimitPlugin, { global: false });
    const added: string[] = [];
    bare.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) {
        if (method !== 'HEAD') added.push(`${method} ${route.url}`);
      }
    });
    await bare.register(adminRoutes({} as AdminService, { secureCookies: false }), {
      prefix: '/api/v1',
    });
    await bare.ready();
    const params = /:\w+/g;
    const checked = ROUTES.map(
      ([method, path]) => `${method} /api/v1${path.replaceAll(ZERO, ':id')}`,
    );
    expect(added.map((r) => r.replace(params, ':id')).sort()).toEqual(
      [...checked, 'POST /api/v1/admin/login', 'POST /api/v1/admin/logout'].sort(),
    );
    expect(added.join('\n')).not.toMatch(/grant|role|totp|enrol/i);
    await bare.close();
  });

  it('answers 403 on every admin route without an admin session', async () => {
    const server = await start();
    const kid = await player();
    const notEnrolled = await player();
    await grantAdmin(db, notEnrolled.username);
    for (const [method, path, body] of ROUTES) {
      // Logged out, a player's own session, a made-up admin cookie, an admin's player session.
      for (const [adminToken, playerToken] of [
        [null, undefined],
        [null, kid.token],
        ['forged-token', kid.token],
        [null, notEnrolled.token],
      ] as const) {
        const res = await adminCall(server, method, path, adminToken, body, playerToken);
        expect(res.statusCode, `${method} ${path}`).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    }
  });

  it('signs in only with the admin role, the password and a fresh authenticator code', async () => {
    const server = await start();
    const boss = await admin();
    const kid = await player();
    const message = "That didn't work. Check your username, password and authenticator code.";

    // Wrong password, wrong code, a player, and a name that doesn't exist all look the same.
    const tries = [
      await login(server, boss, 'nope', nextCode(boss.secret)),
      await login(server, boss, PASSWORD, '000000'),
      await login(server, kid, PASSWORD, nextCode(boss.secret)),
      await login(server, { ...kid, username: 'nobody_here' }, PASSWORD, '123456'),
    ];
    for (const res of tries) {
      expect(res.statusCode).toBe(401);
      expect(errorOf(res)).toEqual({ code: 'UNAUTHENTICATED', message });
      expect(res.cookies.find((c) => c.name === ADMIN_COOKIE)).toBeUndefined();
    }

    const code = nextCode(boss.secret);
    const ok = await login(server, boss, PASSWORD, code);
    expect(ok.statusCode).toBe(200);
    expect(AdminMeResponseSchema.parse(ok.json()).admin.username).toBe(boss.username);
    // The same code can't be used again, even straight away.
    expect((await login(server, boss, PASSWORD, code)).statusCode).toBe(401);

    // Failed tries on the admin account are on record; the player's aren't.
    const signIns = (await db.select().from(adminAudit)).filter(
      (r) => r.action === AUDIT_ACTIONS.signIn && r.actorUserId === boss.id,
    );
    expect(signIns.map((r) => r.outcome).sort()).toEqual(['done', 'failed', 'failed', 'failed']);
  });

  it('needs a confirmed authenticator: a pending setup or a new one blocks sign-in', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    // Replacing the authenticator ends the session and needs a fresh confirm.
    const restarted = await startTotp(db, boss.username, () => adminClock);
    expect((await adminCall(server, 'GET', '/admin/me', token)).statusCode).toBe(403);
    const code = nextCode(restarted!.secret);
    expect((await login(server, boss, PASSWORD, code)).statusCode).toBe(401);
    expect(await confirmTotp(db, boss.username, '000000', () => adminClock)).toBe('wrong_code');
    expect(
      await confirmTotp(db, boss.username, nextCode(restarted!.secret), () => adminClock),
    ).toBe('enrolled');
    await signIn(server, { ...boss, secret: restarted!.secret });
  });

  it('ends a session after 30 idle minutes, and after its hard limit', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    // Activity keeps it alive...
    for (let i = 0; i < 3; i++) {
      adminClock = new Date(adminClock.getTime() + ADMIN_RULES.idleMs - 60_000);
      expect((await adminCall(server, 'GET', '/admin/me', token)).statusCode).toBe(200);
    }
    // ...and idling past the limit ends it, clearing the cookie.
    adminClock = new Date(adminClock.getTime() + ADMIN_RULES.idleMs + 1000);
    const idle = await adminCall(server, 'GET', '/admin/me', token);
    expect(idle.statusCode).toBe(403);
    expect(idle.cookies.find((c) => c.name === ADMIN_COOKIE)?.value).toBe('');

    const busy = await signIn(server, boss);
    const signedInAt = adminClock.getTime();
    while (adminClock.getTime() + ADMIN_RULES.idleMs / 2 < signedInAt + ADMIN_RULES.maxMs) {
      adminClock = new Date(adminClock.getTime() + ADMIN_RULES.idleMs / 2);
      expect((await adminCall(server, 'GET', '/admin/me', busy)).statusCode).toBe(200);
    }
    adminClock = new Date(signedInAt + ADMIN_RULES.maxMs + 1000);
    expect((await adminCall(server, 'GET', '/admin/me', busy)).statusCode).toBe(403);
  });

  it('re-checks the role on every request, and signs out', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    expect((await adminCall(server, 'GET', '/admin/patches', token)).statusCode).toBe(200);
    // A role taken away in the database (not just through the script) ends access at once.
    await createAdminRepo(db).setRole(boss.id, 'player');
    expect((await adminCall(server, 'GET', '/admin/patches', token)).statusCode).toBe(403);
    await createAdminRepo(db).setRole(boss.id, 'admin');

    const again = await signIn(server, boss);
    const out = await adminCall(server, 'POST', '/admin/logout', again);
    expect(out.statusCode).toBe(204);
    expect((await adminCall(server, 'GET', '/admin/me', again)).statusCode).toBe(403);
    expect((await auditRows(AUDIT_ACTIONS.signOut)).some((r) => r.actorUserId === boss.id)).toBe(
      true,
    );
  });

  it('grants admin only through the host-script functions, each on record', async () => {
    const server = await start();
    // Sign-up ignores a smuggled role.
    const res = await playerCall(server, 'POST', '/auth/signup', null, {
      signupCode: 'bootstrap-for-admin-tests',
      username: newName(),
      password: PASSWORD,
      birthYear: 1980,
      timeZone: 'America/Chicago',
      role: 'admin',
    });
    expect(res.statusCode).toBe(201);
    const made = RecoveryCodeResponseSchema.parse(res.json()).user;
    const row = (await db.select().from(users)).find((u) => u.id === made.id);
    expect(row?.role).toBe('player');

    const who = await player();
    expect(await grantAdmin(db, who.username.toUpperCase())).toBe('changed');
    expect(await grantAdmin(db, who.username)).toBe('unchanged');
    expect(await grantAdmin(db, 'nobody_at_all')).toBe('no_such_user');
    expect(await startTotp(db, 'nobody_at_all', () => adminClock)).toBeNull();
    const granted = await auditRows(AUDIT_ACTIONS.granted);
    expect(granted.filter((r) => r.targetUserId === who.id)).toHaveLength(1);
    expect(granted[0]?.actorUserId).toBeNull();

    const started = await startTotp(db, who.username, () => adminClock);
    await confirmTotp(
      db,
      who.username,
      totpCode(started!.secret, totpStep(adminClock)),
      () => adminClock,
    );
    const token = await signIn(server, { ...who, secret: started!.secret });
    expect(await revokeAdmin(db, who.username)).toBe('changed');
    expect((await adminCall(server, 'GET', '/admin/me', token)).statusCode).toBe(403);
    expect((await db.select().from(adminTotp)).filter((r) => r.userId === who.id)).toEqual([]);
    expect((await auditRows(AUDIT_ACTIONS.revoked)).some((r) => r.targetUserId === who.id)).toBe(
      true,
    );
  });

  it('shows patches, one patch, players and a player', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const { owner, waiting, mapId } = await patch(server, patchName('Lantern'));

    const list = AdminPatchesResponseSchema.parse(
      (
        await adminCall(
          server,
          'GET',
          `/admin/patches?q=${encodeURIComponent(owner.username)}`,
          token,
        )
      ).json(),
    );
    expect(list.patches).toHaveLength(1);
    expect(list.patches[0]).toMatchObject({
      id: mapId,
      owner: owner.username,
      members: 1,
      maxPlayers: 4,
      pendingRequests: 1,
      kind: 'multiplayer',
    });

    const detail = AdminPatchDetailSchema.parse(
      (await adminCall(server, 'GET', `/admin/patches/${mapId}`, token)).json(),
    );
    expect(detail.members.map((m) => m.username)).toEqual([owner.username]);
    expect(detail.requests.map((r) => r.username)).toEqual([waiting.username]);
    expect(detail.invite).not.toBeNull();
    // The invite code itself isn't on the page.
    expect(JSON.stringify(detail)).not.toMatch(/"code"/);

    const players = AdminPlayersResponseSchema.parse(
      (await adminCall(server, 'GET', `/admin/players?q=${owner.username}`, token)).json(),
    );
    expect(players.players[0]).toMatchObject({
      username: owner.username,
      role: 'player',
      activeSessions: 1,
      hasRecoveryCode: false,
      patches: 1,
    });

    const one = AdminPlayerDetailSchema.parse(
      (await adminCall(server, 'GET', `/admin/players/${waiting.id}`, token)).json(),
    );
    expect(one.patches).toEqual([expect.objectContaining({ mapId, status: 'requested' })]);
    // Nothing secret about a player ever leaves the server.
    expect(JSON.stringify(one)).not.toMatch(/password|plain:/i);
  });

  it('writes an audit row for every action, marked done or failed', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const { waiting, mapId } = await patch(server, patchName('Cozy'));
    const late = await player();
    const detail = AdminPatchDetailSchema.parse(
      (await adminCall(server, 'GET', `/admin/patches/${mapId}`, token)).json(),
    );
    const requestId = detail.requests[0]!.id;

    const revealed = await adminCall(
      server,
      'POST',
      `/admin/patches/${mapId}/invite/reveal`,
      token,
    );
    expect(revealed.statusCode).toBe(200);
    const fresh = AdminInviteResponseSchema.parse(
      (await adminCall(server, 'POST', `/admin/patches/${mapId}/invite`, token)).json(),
    );
    expect(fresh.code).not.toBe(AdminInviteResponseSchema.parse(revealed.json()).code);
    expect(
      (
        await adminCall(
          server,
          'POST',
          `/admin/patches/${mapId}/requests/${requestId}/approve`,
          token,
        )
      ).statusCode,
    ).toBe(204);
    // A second player asks with the new code; decline them.
    await playerCall(server, 'POST', '/maps/join', late, { code: fresh.code });
    const lateRequest = AdminPatchDetailSchema.parse(
      (await adminCall(server, 'GET', `/admin/patches/${mapId}`, token)).json(),
    ).requests[0]!;
    expect(
      (
        await adminCall(
          server,
          'POST',
          `/admin/patches/${mapId}/requests/${lateRequest.id}/decline`,
          token,
        )
      ).statusCode,
    ).toBe(204);
    const after = AdminPatchDetailSchema.parse(
      (await adminCall(server, 'GET', `/admin/patches/${mapId}`, token)).json(),
    );
    expect(after.members.map((m) => m.username)).toContain(waiting.username);
    expect(after.requests).toEqual([]);

    const ended = await adminCall(
      server,
      'POST',
      `/admin/players/${late.id}/logout-everywhere`,
      token,
    );
    expect(ended.json()).toEqual({ ended: 1 });
    expect((await playerCall(server, 'GET', '/maps', late)).statusCode).toBe(401);
    expect(
      (await adminCall(server, 'POST', `/admin/players/${late.id}/reset-password`, token))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await adminCall(server, 'POST', '/admin/lookup', token, {
          patch: 'cozy',
          from: '2026-01-01',
          to: '2030-01-01',
        })
      ).statusCode,
    ).toBe(200);
    const made = CreateSignupCodeResponseSchema.parse(
      (
        await adminCall(server, 'POST', '/admin/signup-codes', token, {
          label: 'Smith family',
          maxUses: 3,
          days: 7,
        })
      ).json(),
    );
    const codeId = made.signupCode.id;
    expect(
      (await adminCall(server, 'POST', `/admin/signup-codes/${codeId}/extend`, token, { days: 7 }))
        .statusCode,
    ).toBe(204);
    const extended = (await db.select().from(signupCodes)).find((c) => c.id === codeId);
    expect(extended!.expiresAt.getTime() - Date.parse(made.signupCode.expiresAt)).toBe(7 * DAY_MS);
    expect(
      (await adminCall(server, 'POST', `/admin/signup-codes/${codeId}/revoke`, token)).statusCode,
    ).toBe(204);
    // Revoking again fails, and that's on record too.
    expect(
      (await adminCall(server, 'POST', `/admin/signup-codes/${codeId}/revoke`, token)).statusCode,
    ).toBe(404);
    const codes = AdminSignupCodesResponseSchema.parse(
      (await adminCall(server, 'GET', '/admin/signup-codes', token)).json(),
    );
    expect(codes.codes.find((c) => c.id === codeId)?.status).toBe('revoked');

    const mine = (await db.select().from(adminAudit)).filter((r) => r.actorUserId === boss.id);
    const done = (action: string) =>
      mine.filter((r) => r.action === action && r.outcome === 'done').length;
    expect(done(AUDIT_ACTIONS.revealInvite)).toBe(1);
    expect(done(AUDIT_ACTIONS.newInvite)).toBe(1);
    expect(done(AUDIT_ACTIONS.approve)).toBe(1);
    expect(done(AUDIT_ACTIONS.decline)).toBe(1);
    expect(done(AUDIT_ACTIONS.logoutEverywhere)).toBe(1);
    expect(done(AUDIT_ACTIONS.resetPassword)).toBe(1);
    expect(done(AUDIT_ACTIONS.lookup)).toBe(1);
    expect(done(AUDIT_ACTIONS.createCode)).toBe(1);
    expect(done(AUDIT_ACTIONS.extendCode)).toBe(1);
    expect(done(AUDIT_ACTIONS.revokeCode)).toBe(1);
    expect(
      mine.filter((r) => r.action === AUDIT_ACTIONS.revokeCode && r.outcome === 'failed'),
    ).toHaveLength(1);
    expect(mine.every((r) => r.outcome !== 'pending')).toBe(true);
    // Approve names the player and the patch.
    const approved = mine.find((r) => r.action === AUDIT_ACTIONS.approve)!;
    expect(approved).toMatchObject({ targetUserId: waiting.id, targetMapId: mapId });

    const log = AdminAuditResponseSchema.parse(
      (await adminCall(server, 'GET', `/admin/audit?q=${boss.username}`, token)).json(),
    );
    expect(log.entries[0]).toMatchObject({ actor: boss.username });
    expect(log.total).toBeGreaterThanOrEqual(mine.length);
  });

  it('resets a password exactly like the host script: one-time secrets, sessions ended', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const kid = await player();
    const other = await player();

    const res = await adminCall(server, 'POST', `/admin/players/${kid.id}/reset-password`, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const console = AdminResetPasswordResponseSchema.parse(res.json());
    // The CLI runs this same function.
    const cli = await createAuthService({ repo: createAuthRepo(db) }).operatorReset(other.username);

    for (const [who, result] of [
      [kid, console],
      [other, cli!],
    ] as const) {
      // Logged out everywhere.
      expect((await playerCall(server, 'GET', '/maps', who)).statusCode).toBe(401);
      // Same shapes: ABCD-EFGH-JKMN for both secrets.
      expect(result.temporaryPassword).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(result.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      // The temporary password logs in...
      const login = await playerCall(server, 'POST', '/auth/login', null, {
        username: who.username,
        password: result.temporaryPassword,
      });
      expect(login.statusCode).toBe(200);
      // ...and the new recovery code sets their own.
      const recover = await playerCall(server, 'POST', '/auth/recover', null, {
        username: who.username,
        recoveryCode: result.recoveryCode,
        newPassword: 'my-own-password',
      });
      expect(recover.statusCode).toBe(200);
    }
  });

  it('never logs a secret it shows', async () => {
    const server = await start();
    const boss = await admin();
    const code = nextCode(boss.secret);
    const signedIn = await login(server, boss, PASSWORD, code);
    const token = signedIn.cookies.find((c) => c.name === ADMIN_COOKIE)!.value;
    const kid = await player();
    const { mapId } = await patch(server, patchName('Secret'));

    const reset = AdminResetPasswordResponseSchema.parse(
      (await adminCall(server, 'POST', `/admin/players/${kid.id}/reset-password`, token)).json(),
    );
    const invite = AdminInviteResponseSchema.parse(
      (await adminCall(server, 'POST', `/admin/patches/${mapId}/invite/reveal`, token)).json(),
    );
    const family = CreateSignupCodeResponseSchema.parse(
      (
        await adminCall(server, 'POST', '/admin/signup-codes', token, {
          label: 'Lee family',
          maxUses: 2,
          days: 3,
        })
      ).json(),
    );

    const logs = logLines.join('\n');
    expect(logs).toContain('/admin/players/'); // the requests were logged
    for (const secret of [
      reset.temporaryPassword,
      reset.recoveryCode,
      reset.temporaryPassword.replaceAll('-', ''),
      reset.recoveryCode.replaceAll('-', ''),
      invite.code,
      invite.code.replaceAll('-', ''),
      family.code,
      family.code.replaceAll('-', ''),
      PASSWORD,
      code,
      token,
      boss.secret,
    ]) {
      expect(logs).not.toContain(secret);
    }
    // Nor does the audit log hold one.
    const audit = JSON.stringify(await db.select().from(adminAudit));
    for (const secret of [reset.temporaryPassword, reset.recoveryCode, invite.code, family.code]) {
      expect(audit).not.toContain(secret);
    }
  });

  it('finds a forgotten username from the patch name and when they joined', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const name = patchName('Whisper');
    const { owner, waiting } = await patch(server, name);
    const today = new Date().toISOString().slice(0, 10);

    const found = AdminLookupResponseSchema.parse(
      (
        await adminCall(server, 'POST', '/admin/lookup', token, {
          patch: name.slice(0, 12).toLowerCase(),
          from: today,
          to: today,
        })
      ).json(),
    );
    expect(found.matches.map((m) => [m.username, m.status])).toEqual(
      expect.arrayContaining([
        [owner.username, 'owner'],
        [waiting.username, 'requested'],
      ]),
    );
    const none = AdminLookupResponseSchema.parse(
      (
        await adminCall(server, 'POST', '/admin/lookup', token, {
          patch: name,
          from: '2020-01-01',
          to: '2020-01-31',
        })
      ).json(),
    );
    expect(none.matches).toEqual([]);
    // A wildcard typed in the search is taken literally.
    const wild = AdminLookupResponseSchema.parse(
      (
        await adminCall(server, 'POST', '/admin/lookup', token, {
          patch: '%%',
          from: today,
          to: today,
        })
      ).json(),
    );
    expect(wild.matches).toEqual([]);
  });

  /** Makes every update of `admin_audit` fail (an audit outcome that can't be written). */
  async function breakAuditUpdates<T>(run: () => Promise<T>): Promise<T> {
    await db.execute(`create or replace function admin_audit_broken() returns trigger
      language plpgsql as $$ begin raise exception 'audit store down'; end $$`);
    await db.execute(`create trigger admin_audit_broken before update on admin_audit
      for each row execute function admin_audit_broken()`);
    try {
      return await run();
    } finally {
      await db.execute('drop trigger admin_audit_broken on admin_audit');
      await db.execute('drop function admin_audit_broken()');
    }
  }

  it('hands over the secrets of a reset that ran, even when its outcome cannot be recorded', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const kid = await player();
    const other = await player();

    const res = await breakAuditUpdates(() =>
      adminCall(server, 'POST', `/admin/players/${kid.id}/reset-password`, token),
    );
    expect(res.statusCode).toBe(200);
    const reset = AdminResetPasswordResponseSchema.parse(res.json());
    const login = await playerCall(server, 'POST', '/auth/login', null, {
      username: kid.username,
      password: reset.temporaryPassword,
    });
    expect(login.statusCode).toBe(200);
    // The row written before the reset is still there, left unfinished, and the failure is logged.
    const rows = (await auditRows(AUDIT_ACTIONS.resetPassword)).filter(
      (r) => r.targetUserId === kid.id,
    );
    expect(rows.map((r) => r.outcome)).toEqual(['pending']);
    expect(logLines.join('\n')).toContain('admin audit: could not record the outcome');

    // The host script's reset (ops/reset-password.ts) works the same way.
    const errors: object[] = [];
    const cli = await breakAuditUpdates(() =>
      hostAudited(
        db,
        AUDIT_ACTIONS.resetPassword,
        other.id,
        () => createAuthService({ repo: createAuthRepo(db) }).operatorReset(other.username),
        { error: (obj) => errors.push(obj) },
      ),
    );
    expect(cli?.temporaryPassword).toMatch(/^[A-Z0-9]{4}-/);
    expect(errors).toHaveLength(1);
    const cliRows = (await auditRows(AUDIT_ACTIONS.resetPassword)).filter(
      (r) => r.targetUserId === other.id,
    );
    expect(cliRows.map((r) => [r.actorUserId, r.outcome])).toEqual([[null, 'pending']]);
  });

  it('records refused actions too: a missing patch, player or request', async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const { mapId } = await patch(server, patchName('Refused'));
    const before = (await db.select().from(adminAudit)).length;

    const refused = [
      await adminCall(server, 'POST', `/admin/patches/${ZERO}/requests/${ZERO}/approve`, token),
      await adminCall(server, 'POST', `/admin/patches/${mapId}/requests/${ZERO}/decline`, token),
      await adminCall(server, 'POST', `/admin/patches/${ZERO}/invite/reveal`, token),
      await adminCall(server, 'POST', `/admin/patches/${ZERO}/invite`, token),
      await adminCall(server, 'POST', `/admin/players/${ZERO}/reset-password`, token),
      await adminCall(server, 'POST', `/admin/players/${ZERO}/logout-everywhere`, token),
    ];
    expect(refused.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404]);
    const rows = (await db.select().from(adminAudit)).filter((r) => r.actorUserId === boss.id);
    const failed = rows.filter((r) => r.outcome === 'failed');
    expect((await db.select().from(adminAudit)).length - before).toBe(6);
    expect(failed).toHaveLength(6);
    // A target that doesn't exist is named in the detail, not the (foreign-key) column.
    const reset = failed.find((r) => r.action === AUDIT_ACTIONS.resetPassword)!;
    expect(reset.targetUserId).toBeNull();
    expect(reset.detail).toEqual({ userId: ZERO });
    const decline = failed.find((r) => r.action === AUDIT_ACTIONS.decline)!;
    expect(decline.targetMapId).toBe(mapId);
    expect(decline.detail).toEqual({ requestId: ZERO });
  });

  it("extends live codes and the operator's own, but never revives a patch owner's ended code", async () => {
    const server = await start();
    const boss = await admin();
    const token = await signIn(server, boss);
    const { owner } = await patch(server, patchName('Codes'));
    const made = await playerCall(server, 'POST', '/signup-codes', owner, { label: 'Lee family' });
    expect(made.statusCode).toBe(201);
    const ownerCode = CreateSignupCodeResponseSchema.parse(made.json()).signupCode.id;
    const operatorCode = CreateSignupCodeResponseSchema.parse(
      (
        await adminCall(server, 'POST', '/admin/signup-codes', token, {
          label: 'Playtesters',
          maxUses: 5,
          days: 3,
        })
      ).json(),
    ).signupCode.id;
    const extend = (codeId: string) =>
      adminCall(server, 'POST', `/admin/signup-codes/${codeId}/extend`, token, { days: 7 });

    // While live, an owner's code can be extended.
    expect((await extend(ownerCode)).statusCode).toBe(204);
    // Once ended, only the operator's can.
    await db.execute(
      `update signup_codes set expires_at = now() - interval '1 day' where id in ('${ownerCode}', '${operatorCode}')`,
    );
    expect((await extend(ownerCode)).statusCode).toBe(404);
    expect((await extend(operatorCode)).statusCode).toBe(204);
    const rows = await db.select().from(signupCodes);
    expect(rows.find((c) => c.id === ownerCode)!.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(rows.find((c) => c.id === operatorCode)!.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 6 * DAY_MS,
    );
  });

  it('rate-limits sign-in per username', async () => {
    const server = await start();
    const boss = await admin();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await login(server, boss, 'wrong', '000000')).statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });
});
