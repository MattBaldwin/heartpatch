import { ReadyResponseSchema } from '@heartpatch/shared';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDbClient, dbReadinessCheck, type DbClient } from './client.js';

const url = inject('testDatabaseUrl');
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost:5432/unused' });
let client: DbClient | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function readyWith(dbUrl: string) {
  client = createDbClient(dbUrl, { max: 1 });
  const app = await buildApp({ config, readinessChecks: [dbReadinessCheck(client)] });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    return { status: res.statusCode, body: ReadyResponseSchema.parse(res.json()) };
  } finally {
    await app.close();
  }
}

describe('db readiness check', () => {
  it('reports db failed when Postgres is unreachable', async () => {
    // Port 1 refuses connections immediately; no database needed.
    const res = await readyWith('postgres://nobody@127.0.0.1:1/none');
    expect(res).toEqual({ status: 503, body: { status: 'not_ready', checks: { db: 'failed' } } });
  });

  it.skipIf(!url)('reports db ok against a real database (needs DATABASE_URL)', async () => {
    const res = await readyWith(url!);
    expect(res).toEqual({ status: 200, body: { status: 'ready', checks: { db: 'ok' } } });
  });
});
