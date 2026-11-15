// A mini-boss test harness (#190): an app with a stand-in boss, Keepers,
// a patch, a grown team, the clock at the visit and a fight played out.
import {
  BattleResponseSchema,
  GAME_DATA,
  JoinMapResponseSchema,
  MapResponseSchema,
  type PlayerBattle,
  type PublicUser,
} from '@heartpatch/shared';
import {
  BOSS_EVENTS,
  bossVisitFor,
  bossWeekOf,
  type BossEventRules,
} from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import { keepers, sessions, squishies, users } from '../src/db/schema.js';
import { instantOfLocalDate, localDate } from '../src/lib/time.js';
import { SESSION_COOKIE } from '../src/modules/auth/limits.js';
import { newSessionToken } from '../src/modules/auth/secrets.js';

const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
export const BOSS_ZONE = 'America/Denver';
// Noon in Denver on Monday 16 Nov (MST, UTC−7): the start of a boss week.
export const BOSS_START = '2026-11-16T19:00:00Z';
export const BOSS_TEAM = GAME_DATA.species[0]!;
// A stand-in boss (#190 plan §8): an existing species, in tests only.
export const STAND_IN_BOSS = GAME_DATA.species.find((s) => s.id !== BOSS_TEAM.id)!;
export const BOSS_RULES: BossEventRules = {
  ...BOSS_EVENTS,
  bag: [{ speciesId: STAND_IN_BOSS.id, terrains: [GAME_DATA.terrains[0]!.id] }],
};
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  face: 'pip',
  body: 'pip',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};

export interface BossPlayer extends PublicUser {
  token: string;
}

/** One app per `start`; close it with `close()` after each test. */
export function bossHarness(db: Database, url: string, prefix: string) {
  const clock = new Date(BOSS_START);
  let app: FastifyInstance | undefined;
  let counter = 0;

  const call = (
    method: 'GET' | 'POST',
    path: string,
    who: BossPlayer,
    payload?: object,
  ): Promise<LightMyRequestResponse> => {
    if (!app) throw new Error('bossHarness: call start() first');
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  };

  const act = async (who: BossPlayer, battle: PlayerBattle, action: object) => {
    const res = await call('POST', `/battles/${battle.id}/actions`, who, {
      action,
      turn: battle.view.turn,
    });
    expect(res.statusCode, res.body).toBe(200);
    return BattleResponseSchema.parse(res.json()).battle;
  };

  return {
    clock,
    call,
    async start(rules: BossEventRules = BOSS_RULES) {
      app = await buildApp({
        config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: url }),
        db,
        clock: () => clock,
        logger: false,
        bossRules: rules,
      });
      return app;
    },
    async close() {
      await app?.close();
      app = undefined;
      clock.setTime(Date.parse(BOSS_START));
    },
    async player(): Promise<BossPlayer> {
      const username = `${prefix}_${String((counter += 1))}`;
      const [user] = await db
        .insert(users)
        .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: BOSS_ZONE })
        .returning({ id: users.id });
      await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
      const { token, tokenHash } = newSessionToken();
      await db
        .insert(sessions)
        .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
      return { id: user!.id, username, token };
    },
    async patch(owner: BossPlayer) {
      const res = await call('POST', '/maps', owner, { name: 'Boss Patch', timeZone: BOSS_ZONE });
      expect(res.statusCode, res.body).toBe(201);
      return MapResponseSchema.parse(res.json()).map.id;
    },
    /** `other` joins `owner`'s patch by its invite code, approved. */
    async join(mapId: string, owner: BossPlayer, other: BossPlayer) {
      const map = await call('GET', `/maps/${mapId}`, owner);
      expect(map.statusCode, map.body).toBe(200);
      const code = MapResponseSchema.parse(map.json()).map.admin?.invite?.code;
      const join = await call('POST', '/maps/join', other, { code });
      expect(join.statusCode, join.body).toBe(201);
      const { request } = JoinMapResponseSchema.parse(join.json());
      const ok = await call('POST', `/maps/${mapId}/requests/${request.id}/approve`, owner);
      expect(ok.statusCode, ok.body).toBe(204);
    },
    /** A Partner at `partner` and two strong friends: the team. */
    async grow(mapId: string, who: PublicUser, partner: number, friends = [100, 100]) {
      const rows = await db
        .insert(squishies)
        .values(
          [partner, ...friends].map((level) => ({
            mapId,
            ownerUserId: who.id,
            speciesId: BOSS_TEAM.id,
            element: BOSS_TEAM.element,
            feeling: BOSS_TEAM.feeling,
            level,
          })),
        )
        .returning({ id: squishies.id });
      await db.execute(
        `update map_members set starter_squishy_id = '${rows[0]!.id}' where map_id = '${mapId}' and user_id = '${who.id}'`,
      );
    },
    /** Moves the clock a minute past this week's visit opening on the patch. */
    async toVisit(mapId: string, rules: BossEventRules = BOSS_RULES) {
      const map = await db.query.maps.findFirst({ where: (t, { eq }) => eq(t.id, mapId) });
      const week = bossWeekOf(localDate(clock, BOSS_ZONE));
      const plan = bossVisitFor(map!.seed!, week, map!.longNightWeekday ?? null, rules)!;
      const opensAt = instantOfLocalDate(
        { date: plan.opensOn, minute: rules.opensAtHour * 60 },
        BOSS_ZONE,
      );
      clock.setTime(opensAt.getTime() + 60_000);
      return { week, opensAt };
    },
    async fight(who: BossPlayer, mapId: string) {
      const res = await call('POST', `/maps/${mapId}/boss/battle`, who);
      expect(res.statusCode, res.body).toBe(201);
      return BattleResponseSchema.parse(res.json()).battle;
    },
    act,
    /** Plays every fighter's first move until the fight ends. */
    async playOut(who: BossPlayer, start: PlayerBattle) {
      let battle = start;
      for (let round = 0; round < 100 && battle.status === 'active'; round++) {
        const side = battle.view.sides.a;
        const picks = (side.out ?? [])
          .filter((slot) => side.squishies[slot]!.energy > 0)
          .map((slot) => ({ slot, move: side.squishies[slot]!.moves[0]! }));
        battle = await act(who, battle, { type: 'team', picks });
      }
      return battle;
    },
  };
}
