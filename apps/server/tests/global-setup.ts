// Gives DB integration tests a fresh database per run: creates it from
// DATABASE_URL, applies every migration from scratch, and drops it afterwards,
// so tests never touch your dev data. Reads the repo-root .env like the db:*
// scripts do. Without DATABASE_URL the DB tests skip locally, but CI must run them.
import { existsSync } from 'node:fs';
import type { TestProject } from 'vitest/node';
import { createDbClient } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrator.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Migrated scratch database, or null when DATABASE_URL is unset. */
    testDatabaseUrl: string | null;
  }
}

export default async function setup(
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> {
  const envFile = new URL('../../../.env', import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const baseUrl = process.env['DATABASE_URL'];
  if (!baseUrl) {
    if (process.env['CI'])
      throw new Error('DATABASE_URL must be set in CI so DB integration tests run.');
    process.stderr.write(
      '\n⚠ DATABASE_URL is unset: skipping DB integration tests (see src/db/README.md).\n\n',
    );
    project.provide('testDatabaseUrl', null);
    return undefined;
  }

  const name = `heartpatch_test_${String(process.pid)}_${String(Date.now())}`;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${name}`;

  const admin = createDbClient(baseUrl, { max: 1, quiet: true });
  const dropDatabase = async () => {
    await admin.db.execute(`drop database if exists "${name}" with (force)`);
    await admin.close();
  };
  await admin.db.execute(`create database "${name}"`);
  const test = createDbClient(testUrl.href, { max: 1, quiet: true });
  try {
    await runMigrations(test.db);
  } catch (err) {
    await test.close();
    await dropDatabase();
    throw err;
  }
  await test.close();
  project.provide('testDatabaseUrl', testUrl.href);

  return dropDatabase;
}
