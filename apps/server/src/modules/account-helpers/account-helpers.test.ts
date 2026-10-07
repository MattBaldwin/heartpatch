import {
  AccountHelpersResponseSchema,
  ApiErrorSchema,
  HelperCandidatesResponseSchema,
  MeResponseSchema,
  MemberPasswordResetResponseSchema,
  NewRecoveryCodeResponseSchema,
  RecoveryCodeResponseSchema,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  accountHelpers,
  mapMembers,
  maps,
  recoveryCodes,
  sessions,
  users,
} from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import type * as Secrets from '../auth/secrets.js';
import { HELPER_RULES } from './limits.js';

// Cheap stand-in for Argon2 (see auth.test.ts): `plain:<secret>` is a hash.
vi.mock('../auth/secrets.js', async (importOriginal) =>
  (await import('../../../tests/fake-secrets.js')).fakeSecrets(
    await importOriginal<typeof Secrets>(),
  ),
);

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'squishy-secret';
const RECOVERY = 'ABCDEFGHJKMN';

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('grown-up helpers (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance;
  let clock = new Date();
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  // A fresh app per test: the route rate limits count per process.
  beforeEach(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: 'helpers-test-code',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
  });
  afterEach(async () => {
    await app.close();
    clock = new Date();
  });

  /** A logged-in player with a known password and recovery code. */
  async function player(options: { invitedBy?: string } = {}): Promise<Player> {
    const username = `helpkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash: `plain:${PASSWORD}`,
        birthYear: 2014,
        invitedBy: options.invitedBy ?? null,
      })
      .returning({ id: users.id });
    await db.insert(recoveryCodes).values({ userId: user!.id, codeHash: `plain:${RECOVERY}` });
    return { id: user!.id, username, token: await login(user!.id) };
  }

  /** Another logged-in device for the same player. */
  async function login(userId: string): Promise<string> {
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return token;
  }

  /** A patch with these members; the first is its owner. */
  async function patch(name: string, members: Player[]): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name, timeZone: 'America/Chicago' })
      .returning({ id: maps.id });
    await db.insert(mapMembers).values(
      members.map((m, i) => ({
        mapId: map!.id,
        userId: m.id,
        role: i === 0 ? ('owner' as const) : ('member' as const),
      })),
    );
    return map!.id;
  }

  function call(
    method: 'GET' | 'POST',
    path: string,
    who: Player | string | null,
    payload?: object,
  ) {
    const token = typeof who === 'string' ? who : who?.token;
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(token ? { cookies: { [SESSION_COOKIE]: token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const linksOf = (res: LightMyRequestResponse) => {
    expect(res.statusCode).toBe(200);
    return AccountHelpersResponseSchema.parse(res.json());
  };
  const mine = async (who: Player) => linksOf(await call('GET', '/account/helpers', who));
  const candidates = async (who: Player) => {
    const res = await call('GET', '/account/helpers/candidates', who);
    expect(res.statusCode).toBe(200);
    return HelperCandidatesResponseSchema.parse(res.json()).candidates;
  };
  const ask = (who: Player, helper: Player) =>
    call('POST', '/account/helpers', who, { helperId: helper.id });
  const answer = (helper: Player, kid: Player, verb: 'accept' | 'decline' | 'remove') =>
    call('POST', `/account/helping/${kid.id}/${verb}`, helper);
  const reset = (helper: Player, kid: Player) =>
    call('POST', `/account/helping/${kid.id}/reset-password`, helper);

  /** A grown-up the kid can pick (they share a patch), linked with both sides agreeing. */
  async function linked(): Promise<{ grownup: Player; kid: Player }> {
    const grownup = await player();
    const kid = await player();
    await patch('Pumpkin Hill', [grownup, kid]);
    linksOf(await ask(kid, grownup));
    linksOf(await answer(grownup, kid, 'accept'));
    return { grownup, kid };
  }

  async function loggedIn(token: string): Promise<boolean> {
    const res = await call('GET', '/me', token);
    return MeResponseSchema.parse(res.json()).user !== null;
  }

  async function recover(username: string, recoveryCode: string) {
    return call('POST', '/auth/recover', null, {
      username,
      recoveryCode,
      newPassword: 'brand-new-secret',
    });
  }

  describe('candidates', () => {
    it('lists who brought you in and your patch-mates, never strangers', async () => {
      const inviter = await player();
      const kid = await player({ invitedBy: inviter.id });
      const owner = await player();
      const mate = await player();
      const stranger = await player();
      await patch('Moonlit Meadow', [owner, kid, mate]);
      await patch('Stranger Patch', [stranger]);

      const list = await candidates(kid);
      expect(list.map((c) => [c.user.username, c.reason, c.patchName])).toEqual([
        [inviter.username, 'invited-you', null],
        [owner.username, 'patch-owner', 'Moonlit Meadow'],
        [mate.username, 'patch-mate', 'Moonlit Meadow'],
      ]);
    });

    it('leaves out removed patch-mates, tutorial maps and anyone already asked', async () => {
      const kid = await player();
      const asked = await player();
      const gone = await player();
      const mapId = await patch('Pumpkin Hill', [asked, kid]);
      await db
        .insert(mapMembers)
        .values({ mapId, userId: gone.id, role: 'member', status: 'removed' });
      const [tutorial] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'Glade', timeZone: 'UTC' })
        .returning({ id: maps.id });
      const glader = await player();
      await db.insert(mapMembers).values([
        { mapId: tutorial!.id, userId: kid.id, role: 'member' },
        { mapId: tutorial!.id, userId: glader.id, role: 'owner' },
      ]);

      expect((await candidates(kid)).map((c) => c.user.id)).toEqual([asked.id]);
      linksOf(await ask(kid, asked));
      expect(await candidates(kid)).toEqual([]);
    });

    it('needs a login', async () => {
      expect((await call('GET', '/account/helpers/candidates', null)).statusCode).toBe(401);
      expect((await call('GET', '/account/helpers', null)).statusCode).toBe(401);
    });
  });

  describe('asking and answering', () => {
    it('needs both sides: an ask is pending until the helper says yes', async () => {
      const grownup = await player();
      const kid = await player({ invitedBy: grownup.id });

      const asked = linksOf(await ask(kid, grownup));
      expect(asked.helpers).toEqual([
        { user: { id: grownup.id, username: grownup.username }, status: 'pending' },
      ]);
      expect((await mine(grownup)).asks).toEqual([{ id: kid.id, username: kid.username }]);
      // Not yet a helper: no reset.
      expect((await reset(grownup, kid)).statusCode).toBe(403);

      const accepted = linksOf(await answer(grownup, kid, 'accept'));
      expect(accepted.asks).toEqual([]);
      expect(accepted.helping).toEqual([{ id: kid.id, username: kid.username }]);
      expect((await mine(kid)).helpers[0]!.status).toBe('active');
    });

    it("can't ask a stranger, yourself, or the same grown-up twice", async () => {
      const kid = await player();
      const stranger = await player();
      const grownup = await player();
      await patch('Pumpkin Hill', [grownup, kid]);

      const strangerAsk = await ask(kid, stranger);
      expect(strangerAsk.statusCode).toBe(404);
      expect(errorOf(strangerAsk).message).toBe('You can only ask someone from your list.');
      expect((await ask(kid, kid)).statusCode).toBe(404);

      linksOf(await ask(kid, grownup));
      const again = await ask(kid, grownup);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).message).toBe('You already asked them!');
    });

    it(`allows ${String(HELPER_RULES.helpersPerPlayer)} helpers per player, asks included`, async () => {
      const kid = await player();
      const grownups = await Promise.all(
        Array.from({ length: HELPER_RULES.helpersPerPlayer + 1 }, () => player()),
      );
      await patch('Big Family', [kid, ...grownups.slice(0, 3)]);
      for (const g of grownups.slice(0, HELPER_RULES.helpersPerPlayer)) linksOf(await ask(kid, g));
      expect((await mine(kid)).canAddHelper).toBe(false);

      const third = await ask(kid, grownups[HELPER_RULES.helpersPerPlayer]!);
      expect(third.statusCode).toBe(409);
      expect(errorOf(third).message).toMatch(/Remove one/);

      // Taking one back makes room.
      linksOf(await call('POST', `/account/helpers/${grownups[0]!.id}/remove`, kid));
      expect((await mine(kid)).canAddHelper).toBe(true);
      linksOf(await ask(kid, grownups[HELPER_RULES.helpersPerPlayer]!));
    });

    it(`lets a helper help at most ${String(HELPER_RULES.playersPerHelper)} players`, async () => {
      const grownup = await player();
      const others = await Promise.all(
        Array.from({ length: HELPER_RULES.playersPerHelper }, () => player()),
      );
      // Asks not answered yet count too.
      await db.insert(accountHelpers).values(
        others.map((o, i) => ({
          userId: o.id,
          helperUserId: grownup.id,
          status: i % 2 === 0 ? ('active' as const) : ('pending' as const),
        })),
      );
      const kid = await player({ invitedBy: grownup.id });
      const res = await ask(kid, grownup);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toMatch(/helping lots of players/);
    });

    it('lets only two asks through when four are sent at once', async () => {
      const kid = await player();
      const grownups = await Promise.all(Array.from({ length: 4 }, () => player()));
      await patch('Busy Patch', [kid, ...grownups]);
      const results = await Promise.all(grownups.map((g) => ask(kid, g)));
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 409, 409]);
      expect((await mine(kid)).helpers).toHaveLength(HELPER_RULES.helpersPerPlayer);
    });

    it('a "no" just makes the ask go away, and can be asked again', async () => {
      const grownup = await player();
      const kid = await player({ invitedBy: grownup.id });
      linksOf(await ask(kid, grownup));
      linksOf(await answer(grownup, kid, 'decline'));

      expect((await mine(kid)).helpers).toEqual([]);
      expect((await mine(grownup)).asks).toEqual([]);
      expect((await answer(grownup, kid, 'accept')).statusCode).toBe(404);
      linksOf(await ask(kid, grownup));
    });
  });

  describe('helper reset (scope rules mirror decision D)', () => {
    it('resets a linked player: sessions revoked, new password and recovery code, recorded', async () => {
      const { grownup, kid } = await linked();
      const otherDevice = await login(kid.id);

      const res = await reset(grownup, kid);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const result = MemberPasswordResetResponseSchema.parse(res.json());
      expect(result.user).toEqual({ id: kid.id, username: kid.username });

      // Every session is revoked.
      expect(await loggedIn(kid.token)).toBe(false);
      expect(await loggedIn(otherDevice)).toBe(false);
      // The helper stays logged in.
      expect(await loggedIn(grownup.token)).toBe(true);

      // The old recovery code is void; the new password and code work.
      expect((await recover(kid.username, RECOVERY)).statusCode).toBe(401);
      const login2 = await call('POST', '/auth/login', null, {
        username: kid.username,
        password: result.temporaryPassword,
      });
      expect(login2.statusCode).toBe(200);
      expect((await recover(kid.username, result.recoveryCode)).statusCode).toBe(200);

      const rows = await db.query.accountHelperResets.findMany({
        where: (r, { eq }) => eq(r.userId, kid.id),
      });
      expect(rows).toEqual([expect.objectContaining({ userId: kid.id, helperUserId: grownup.id })]);
    });

    it("a non-helper can't reset, even an owner on the kid's patch", async () => {
      const owner = await player();
      const kid = await player();
      await patch('Pumpkin Hill', [owner, kid]);
      const res = await reset(owner, kid);
      expect(res.statusCode).toBe(403);
      expect(await loggedIn(kid.token)).toBe(true);
    });

    it("the player can't reset their helper (links go one way)", async () => {
      const { grownup, kid } = await linked();
      expect((await reset(kid, grownup)).statusCode).toBe(403);
    });

    it("a declined ask can't reset", async () => {
      const grownup = await player();
      const kid = await player({ invitedBy: grownup.id });
      linksOf(await ask(kid, grownup));
      linksOf(await answer(grownup, kid, 'decline'));
      expect((await reset(grownup, kid)).statusCode).toBe(403);
    });

    it("a link removed by the player can't reset", async () => {
      const { grownup, kid } = await linked();
      linksOf(await call('POST', `/account/helpers/${grownup.id}/remove`, kid));
      expect((await mine(grownup)).helping).toEqual([]);
      expect((await reset(grownup, kid)).statusCode).toBe(403);
      expect(await loggedIn(kid.token)).toBe(true);
    });

    it("a link the helper stopped can't reset", async () => {
      const { grownup, kid } = await linked();
      linksOf(await answer(grownup, kid, 'remove'));
      expect((await mine(kid)).helpers).toEqual([]);
      expect((await reset(grownup, kid)).statusCode).toBe(403);
    });

    it(`allows ${String(HELPER_RULES.resetsPerDay)} resets a day per helper, across players`, async () => {
      const { grownup, kid } = await linked();
      const kid2 = await player({ invitedBy: grownup.id });
      linksOf(await ask(kid2, grownup));
      linksOf(await answer(grownup, kid2, 'accept'));

      for (let i = 0; i < HELPER_RULES.resetsPerDay - 1; i += 1) {
        expect((await reset(grownup, kid)).statusCode).toBe(200);
      }
      expect((await reset(grownup, kid2)).statusCode).toBe(200);
      const over = await reset(grownup, kid2);
      expect(over.statusCode).toBe(429);
      expect(errorOf(over).message).toMatch(/Try again tomorrow/);

      clock = new Date(clock.getTime() + DAY_MS + 1000);
      expect((await reset(grownup, kid2)).statusCode).toBe(200);
    });

    it(`lets only ${String(HELPER_RULES.resetsPerDay)} of 5 resets at once through`, async () => {
      const { grownup, kid } = await linked();
      const kid2 = await player({ invitedBy: grownup.id });
      linksOf(await ask(kid2, grownup));
      linksOf(await answer(grownup, kid2, 'accept'));
      const results = await Promise.all([kid, kid2, kid, kid2, kid].map((k) => reset(grownup, k)));
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 429, 429]);
      const rows = await db.query.accountHelperResets.findMany({
        where: (r, { eq }) => eq(r.helperUserId, grownup.id),
      });
      expect(rows).toHaveLength(HELPER_RULES.resetsPerDay);
    });

    it('needs a login', async () => {
      const { kid } = await linked();
      expect(
        (await call('POST', `/account/helping/${kid.id}/reset-password`, null)).statusCode,
      ).toBe(401);
    });
  });

  describe('a new recovery code', () => {
    it('needs the password, voids the old code and keeps the player logged in', async () => {
      const kid = await player();

      const wrong = await call('POST', '/auth/recovery-code', kid, { password: 'not-it-at-all' });
      expect(wrong.statusCode).toBe(400);
      expect(errorOf(wrong).message).toBe("Hmm, that password isn't right. Try again!");

      const res = await call('POST', '/auth/recovery-code', kid, { password: PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const { recoveryCode } = NewRecoveryCodeResponseSchema.parse(res.json());
      expect(await loggedIn(kid.token)).toBe(true);

      expect((await recover(kid.username, RECOVERY)).statusCode).toBe(401);
      const recovered = await recover(kid.username, recoveryCode);
      expect(recovered.statusCode).toBe(200);
      RecoveryCodeResponseSchema.parse(recovered.json());
    });

    it('makes three codes at once without a hiccup, leaving one that works', async () => {
      const kid = await player();
      const results = await Promise.all(
        [1, 2, 3].map(() => call('POST', '/auth/recovery-code', kid, { password: PASSWORD })),
      );
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      const active = await db.query.recoveryCodes.findMany({
        where: (c, { and, eq, isNull }) => and(eq(c.userId, kid.id), isNull(c.usedAt)),
      });
      expect(active).toHaveLength(1);
    });

    it("races a helper's reset of the same player without a hiccup", async () => {
      const { grownup, kid } = await linked();
      const [own, theirs] = await Promise.all([
        call('POST', '/auth/recovery-code', kid, { password: PASSWORD }),
        reset(grownup, kid),
      ]);
      expect(theirs.statusCode).toBe(200);
      // The kid's request lands first, or finds the password changed (400)
      // or its session revoked (401): never a 500.
      expect([200, 400, 401]).toContain(own.statusCode);
      const active = await db.query.recoveryCodes.findMany({
        where: (c, { and, eq, isNull }) => and(eq(c.userId, kid.id), isNull(c.usedAt)),
      });
      expect(active).toHaveLength(1);
    });

    // Recover with a code used to retire the code before locking the account,
    // the other way round from these; together they deadlocked (a 500).
    it('races recover-with-code without a deadlock', async () => {
      for (let round = 0; round < 3; round += 1) {
        const kid = await player();
        const results = await Promise.all([
          call('POST', '/auth/recovery-code', kid, { password: PASSWORD }),
          recover(kid.username, RECOVERY),
        ]);
        for (const res of results) expect(res.statusCode).toBeLessThan(500);
        const active = await db.query.recoveryCodes.findMany({
          where: (c, { and, eq, isNull }) => and(eq(c.userId, kid.id), isNull(c.usedAt)),
        });
        expect(active).toHaveLength(1);
      }
    });

    it("races a helper's reset against recover-with-code without a deadlock", async () => {
      for (let round = 0; round < 3; round += 1) {
        const { grownup, kid } = await linked();
        const [theirs, own] = await Promise.all([
          reset(grownup, kid),
          recover(kid.username, RECOVERY),
        ]);
        expect(theirs.statusCode).toBe(200);
        // Recover first, or the code was already replaced by the reset.
        expect([200, 401]).toContain(own.statusCode);
        const active = await db.query.recoveryCodes.findMany({
          where: (c, { and, eq, isNull }) => and(eq(c.userId, kid.id), isNull(c.usedAt)),
        });
        expect(active).toHaveLength(1);
      }
    });

    it('needs a login', async () => {
      expect(
        (await call('POST', '/auth/recovery-code', null, { password: PASSWORD })).statusCode,
      ).toBe(401);
    });
  });
});
