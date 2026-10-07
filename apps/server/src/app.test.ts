import {
  ApiErrorSchema,
  HealthResponseSchema,
  queryArray,
  queryInt,
  ReadyResponseSchema,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type BuildAppOptions } from './app.js';
import { loadConfig } from './config.js';
import { AppError } from './lib/errors.js';
import type { ZodTypeProvider } from './lib/zod.js';

const env = {
  NODE_ENV: 'test',
  APP_VERSION: '1.2.3',
  DATABASE_URL: 'postgres://localhost:5432/unused',
};
const config = loadConfig(env);
let app: FastifyInstance | undefined;

async function start(options: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  app = await buildApp({ config, ...options });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/v1/health', () => {
  it('returns 200 with a valid health body', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body.version).toBe('1.2.3');
    expect(body).toMatchObject({ build: null, commit: null });
  });

  it("reports the server's build number and commit, and nothing else about it (#198)", async () => {
    const built = loadConfig({ ...env, APP_BUILD: '214', APP_COMMIT: 'cb04682' });
    const res = await (
      await start({ config: built })
    ).inject({
      method: 'GET',
      url: '/api/v1/health',
    });
    const body = HealthResponseSchema.parse(res.json());
    expect(body).toMatchObject({ build: 214, commit: 'cb04682' });
    expect(Object.keys(res.json<Record<string, unknown>>()).sort()).toEqual([
      'build',
      'commit',
      'status',
      'uptimeSeconds',
      'version',
    ]);
  });
});

describe('build config (#198)', () => {
  it('treats empty build args as unset', () => {
    expect(loadConfig({ ...env, APP_BUILD: '', APP_COMMIT: '' })).toMatchObject({
      APP_BUILD: undefined,
      APP_COMMIT: undefined,
    });
  });

  it('keeps the first 7 digits of a full sha, as the client build does', () => {
    const sha = 'cb04682f1e2d3c4b5a69788796a5b4c3d2e1f001';
    expect(loadConfig({ ...env, APP_BUILD: '214', APP_COMMIT: sha }).APP_COMMIT).toBe('cb04682');
  });

  it('refuses a build number or commit that is not one', () => {
    expect(() => loadConfig({ ...env, APP_BUILD: 'abc' })).toThrow();
    expect(() => loadConfig({ ...env, APP_COMMIT: 'not-a-sha' })).toThrow();
  });
});

describe('GET /api/v1/ready', () => {
  it('is ready when every check passes', async () => {
    const server = await start({
      readinessChecks: [{ name: 'db', check: () => Promise.resolve() }],
    });
    const res = await server.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(ReadyResponseSchema.parse(res.json())).toEqual({
      status: 'ready',
      checks: { db: 'ok' },
    });
  });

  it('returns 503 and names the failing check', async () => {
    const server = await start({
      readinessChecks: [
        { name: 'db', check: () => Promise.reject(new Error('connection refused')) },
        { name: 'other', check: () => Promise.resolve() },
      ],
    });
    const res = await server.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { db: 'failed', other: 'ok' } });
  });
});

describe('error envelope', () => {
  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION_FAILED when a request fails its zod schema', async () => {
    const server = await start();
    const typed = server.withTypeProvider<ZodTypeProvider>();
    typed.post('/echo', { schema: { body: z.object({ name: z.string().min(1) }) } }, (request) => {
      if (request.body.name === 'forbidden') throw new AppError('FORBIDDEN');
      return { ok: true };
    });

    const bad = await server.inject({ method: 'POST', url: '/echo', payload: { name: '' } });
    expect(bad.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(bad.json()).error.code).toBe('VALIDATION_FAILED');

    const forbidden = await server.inject({
      method: 'POST',
      url: '/echo',
      payload: { name: 'forbidden' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(forbidden.json()).error.code).toBe('FORBIDDEN');
  });

  it('keeps the envelope when a route declares its own schema for an error status', async () => {
    const server = await start();
    server.withTypeProvider<ZodTypeProvider>().post(
      '/strict',
      {
        schema: {
          body: z.object({ name: z.string().min(1) }),
          response: { 200: z.object({ ok: z.boolean() }), 400: z.object({ custom: z.string() }) },
        },
      },
      () => ({ ok: true }),
    );
    const res = await server.inject({ method: 'POST', url: '/strict', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_FAILED');
    expect(res.body).not.toContain('invalid_type');
  });

  it('returns BAD_REQUEST for malformed JSON', async () => {
    const server = await start();
    server.post('/echo', () => ({ ok: true }));
    const res = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('keeps the envelope for unsupported content types', async () => {
    const server = await start();
    server.post('/echo', () => ({ ok: true }));
    const res = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'text/csv' },
      payload: 'a,b',
    });
    expect(res.statusCode).toBe(415);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });

  it('hides internal error details', async () => {
    const server = await start();
    server.get('/boom', () => {
      throw new Error('secret stack detail');
    });
    const res = await server.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('INTERNAL');
  });
});

describe('TRUST_PROXY', () => {
  async function ipFor(
    trustProxy: string,
    forwardedFor: string,
    remoteAddress = '172.18.0.5',
  ): Promise<unknown> {
    const server = await start({
      config: loadConfig({ ...env, TRUST_PROXY: trustProxy }),
    });
    server.get('/ip', (request) => ({ ip: request.ip }));
    const res = await server.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    return res.json();
  }

  it('trusts only the one hop Caddy adds, so a client cannot spoof its IP', async () => {
    // A client sent its own X-Forwarded-For; Caddy appended the real peer.
    expect(await ipFor('true', '6.6.6.6, 203.0.113.7')).toEqual({ ip: '203.0.113.7' });
  });

  it('never trusts a peer outside the private network', async () => {
    // Someone reaching the server directly can't pick their own IP.
    expect(await ipFor('true', '203.0.113.7', '198.51.100.9')).toEqual({ ip: '198.51.100.9' });
  });

  it('trusts an IPv4-mapped or IPv6 private peer', async () => {
    expect(await ipFor('true', '203.0.113.7', '::ffff:172.18.0.5')).toEqual({ ip: '203.0.113.7' });
    expect(await ipFor('true', '203.0.113.7', 'fd00::5')).toEqual({ ip: '203.0.113.7' });
  });

  it('ignores X-Forwarded-For when false', async () => {
    expect(await ipFor('false', '203.0.113.7')).toEqual({ ip: '172.18.0.5' });
  });
});

describe('query params', () => {
  it('parses query helpers through Fastify', async () => {
    const server = await start();
    server.withTypeProvider<ZodTypeProvider>().get(
      '/q',
      {
        schema: {
          querystring: z.object({ n: queryInt({ min: 1 }), tag: queryArray(z.string()) }),
        },
      },
      (request) => ({ n: request.query.n, tag: request.query.tag }),
    );

    const one = await server.inject({ method: 'GET', url: '/q?n=5&tag=a' });
    expect(one.json()).toEqual({ n: 5, tag: ['a'] });

    const many = await server.inject({ method: 'GET', url: '/q?n=5&tag=a&tag=b' });
    expect(many.json()).toEqual({ n: 5, tag: ['a', 'b'] });

    const empty = await server.inject({ method: 'GET', url: '/q?n=&tag=a' });
    expect(empty.statusCode).toBe(400);
  });
});
