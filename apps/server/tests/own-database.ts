// Test helper (#895): a fully migrated database of one test file's own, for
// tests that run DDL (a migration's statements, its DOWN, a backfill over a
// whole table). DDL takes AccessExclusiveLocks, and dropping a foreign key
// takes one on the table it points at too (`drop table boss_bar_chips` locks
// `map_members`). On the shared test database that blocks, and can deadlock
// (40P01), the other test files running beside it. Here the database is a
// copy of the migrated template global-setup makes, so it costs one
// `create database` instead of a migration run.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, inject } from 'vitest';
import { createDbClient } from '../src/db/client.js';

/**
 * The URL of a migrated database only this test file uses, or null when
 * DATABASE_URL is unset (the DB tests skip). Call it once at the top of the
 * file, in place of `inject('testDatabaseUrl')`: the URL is known at once,
 * for `it.skipIf(!url)`, and the database exists from `beforeAll` until
 * `afterAll` drops it. It registers those hooks itself, unlike
 * `databaseBefore` (`tests/before-migration.ts`), because the URL must exist
 * while tests are collected; use that one for a schema before a migration.
 */
export function ownDatabaseUrl(): string | null {
  const sharedUrl = inject('testDatabaseUrl');
  const template = inject('testTemplateDatabase');
  if (!sharedUrl || !template) return null;

  // Named after the run (`<shared>_own_<random>`, under Postgres's 63-byte
  // limit) so global teardown drops it even if this file never gets to.
  const name = `${new URL(sharedUrl).pathname.slice(1)}_own_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const url = new URL(sharedUrl);
  url.pathname = `/${name}`;
  // `create database` only reads the template's catalog, so this connection
  // can sit on the shared database; nothing ever connects to the template.
  const admin = () => createDbClient(sharedUrl, { max: 1, quiet: true });

  beforeAll(async () => {
    const client = admin();
    try {
      await client.db.execute(`create database "${name}" template "${template}"`);
    } finally {
      await client.close();
    }
  });
  afterAll(async () => {
    const client = admin();
    try {
      await client.db.execute(`drop database if exists "${name}" with (force)`);
    } finally {
      await client.close();
    }
  });
  return url.href;
}
