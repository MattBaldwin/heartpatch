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
 * `afterAll` drops it.
 */
export function ownDatabaseUrl(): string | null {
  const sharedUrl = inject('testDatabaseUrl');
  const template = inject('testTemplateDatabase');
  if (!sharedUrl || !template) return null;

  const name = `heartpatch_own_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
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
