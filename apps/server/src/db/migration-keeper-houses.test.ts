import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './migrator.js';

// The Keeper's house migration (#381) is expand-only (tech spec §4 rule 5):
// three new tables and their keys, nothing on an existing table, no
// backfill (no `keeper_houses` row reads as level 1), so the previous
// release runs unchanged against the migrated schema.
const file = readdirSync(migrationsFolder).find((f) => f.endsWith('_keeper_houses.sql'));
const statements = readFileSync(join(migrationsFolder, file ?? 'missing.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const NEW_TABLES = ['keeper_houses', 'house_residents', 'house_gifts'];

describe('the keeper houses migration (#381)', () => {
  it('creates the three house tables', () => {
    const created = statements
      .map((s) => /^CREATE TABLE "([a-z_]+)"/.exec(s)?.[1])
      .filter((t): t is string => t !== undefined);
    expect(created.sort()).toEqual([...NEW_TABLES].sort());
  });

  it('only adds: every other statement keys or indexes one of the new tables', () => {
    for (const s of statements) {
      if (s.startsWith('CREATE TABLE')) continue;
      const table = /^(?:ALTER TABLE|CREATE INDEX "[a-z_]+" ON) "([a-z_]+)"/.exec(s)?.[1];
      expect(NEW_TABLES, s).toContain(table);
      // A foreign key's `ON UPDATE`/`ON DELETE` rules aren't writes.
      const body = s.replace(/ON (UPDATE|DELETE) (no action|cascade|set null)/g, '');
      expect(body, s).not.toMatch(/\b(DROP|UPDATE|INSERT|RENAME|ALTER COLUMN)\b/);
    }
  });
});
