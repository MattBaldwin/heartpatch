import { ApiErrorSchema, PERF_REPORT_MAX_BYTES, type PerfReport } from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { PERF_RATE_LIMITS } from './limits.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** A report like the one a phone stuck at 1 fps on the lake sends. */
const REPORT: PerfReport = {
  fps: 1.2,
  slowMs: 5040,
  frames: { count: 60, gapMs: { avg: 830.5, max: 1012 }, renderMs: { avg: 1.1, max: 2.4 } },
  gpu: { lastMs: 1004, avgMs: 812.25, maxMs: 1210, pending: 1, passed: 340 },
  governor: {
    tier: 'low',
    pinned: false,
    renderScale: 0.5,
    pixelRatio: 1,
    decisions: [
      { atMs: 61_200, tier: 'medium', renderScale: 0.85, fps: 21.4 },
      { atMs: 64_900, tier: 'low', renderScale: 0.5, fps: 2.9 },
    ],
  },
  badge: [
    '1 fps · WebGL2 · low · 1.00x · 19 draws · 172k tris',
    'js 1.0 ms · 48 mesh · 20 mat · 5 tex · 0 anim · buf +40/-12 · gltex +9/-2 · vao +30/-4 · 27 prog · 6 up · 0.50 scale',
    'page · 1 engine · 1 fr/s · 0 snap · rt 2: 786x1318, 550x922 ×2 · 1 canvas · 959 dom · 0 css · nopost',
  ],
  badgeCountingMs: 4100,
  sincePageLoadMs: 420_000,
  sinceSceneOpenMs: 95_000,
  visibility: 'visible',
  flags: ['nopost'],
  renderer: 'webgl2',
};

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('perf report (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let logLines: string[] = [];
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    logLines = [];
  });

  async function start(): Promise<FastifyInstance> {
    // The real production config: the route needs no dev flag.
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({
      config,
      db,
      logger: { level: 'info', stream: { write: (line: string) => logLines.push(line) } },
    });
    return app;
  }

  /** A logged-in player, written straight to the database. */
  async function player(): Promise<Player> {
    const username = `slowphone_${String((counter += 1))}`;
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

  function post(server: FastifyInstance, who: Player | null, body: unknown) {
    return server.inject({
      method: 'POST',
      url: '/api/v1/perf/report',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const reportLines = () =>
    logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry['msg'] === 'perf-report');

  it('needs a logged-in player', async () => {
    const server = await start();
    expect(errorOf(await post(server, null, REPORT)).code).toBe('UNAUTHENTICATED');
    expect(reportLines()).toEqual([]);
  });

  it('logs one perf-report line with the user id and the numbers, and no username', async () => {
    const server = await start();
    const kid = await player();
    const res = await post(server, kid, REPORT);
    expect(res.statusCode).toBe(204);
    const lines = reportLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!['userId']).toBe(kid.id);
    expect(lines[0]!['perfReport']).toEqual(REPORT);
    expect(logLines.join('\n')).not.toContain(kid.username);
  });

  it('takes a report with no GPU latency and no badge (WebGPU, or before the badge counted)', async () => {
    const server = await start();
    const kid = await player();
    const res = await post(server, kid, { ...REPORT, gpu: null, badge: [], renderer: 'webgpu' });
    expect(res.statusCode).toBe(204);
  });

  it.each([
    ['an unknown field', { ...REPORT, username: 'someone' }],
    ['a missing field', { ...REPORT, fps: undefined }],
    ['a negative time', { ...REPORT, sinceSceneOpenMs: -1 }],
    ['an unknown tier', { ...REPORT, governor: { ...REPORT.governor, tier: 'ultra' } }],
    [
      'more than 10 decisions',
      {
        ...REPORT,
        governor: {
          ...REPORT.governor,
          decisions: Array.from({ length: 11 }, () => REPORT.governor.decisions[0]),
        },
      },
    ],
    ['free text in a badge line', { ...REPORT, badge: ['hi <b>there</b>\nnext line'] }],
    ['a flag with spaces', { ...REPORT, flags: ['no post'] }],
    ['a render scale above 1', { ...REPORT, governor: { ...REPORT.governor, renderScale: 1.5 } }],
  ])('refuses %s', async (_name, body) => {
    const server = await start();
    const kid = await player();
    expect(errorOf(await post(server, kid, body)).code).toBe('VALIDATION_FAILED');
    expect(reportLines()).toEqual([]);
  });

  it('refuses a body over the size limit before reading it', async () => {
    const server = await start();
    const kid = await player();
    const big = JSON.stringify({ ...REPORT, padding: 'x'.repeat(PERF_REPORT_MAX_BYTES) });
    const res = await post(server, kid, big);
    expect(res.statusCode).toBe(413);
    expect(reportLines()).toEqual([]);
  });

  it('rate-limits reports per player, not across players', async () => {
    const server = await start();
    const [kid, sibling] = [await player(), await player()];
    const { max } = PERF_RATE_LIMITS.report.perUser;
    for (let i = 0; i < max; i += 1) {
      expect((await post(server, kid, REPORT)).statusCode).toBe(204);
    }
    const limited = await post(server, kid, REPORT);
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await post(server, sibling, REPORT)).statusCode).toBe(204);
    expect(reportLines()).toHaveLength(max + 1);
  });
});
