import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { PgDialect, type PgSession } from 'drizzle-orm/pg-core';
import type { Database } from './client.js';

/** Generated SQL migrations; the build copies them next to the compiled code. */
export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * The migration that adds the unique index on `buildings.tile_id` (#295,
 * migration B). Tiles still holding 2+ buildings must be packed up just
 * before it, with code the SQL can't hold (refunds from the building data,
 * trainees' XP, a Factory's batches): the migrate command passes
 * `packCrowdedTiles` as `beforeOneBuildingPerTile` (`cli.ts`).
 */
export const ONE_BUILDING_PER_TILE = '0048_one_building_per_tile';

/** When `tag` was generated: drizzle applies a migration newer than the last one applied. */
function migrationMillis(tag: string): number {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.tag === tag);
  if (!entry) throw new Error(`migration ${tag} is missing from the journal`);
  return entry.when;
}

/** Drizzle's own `migrate`, over `migrations` only. */
async function apply(db: Database, migrations: readonly MigrationMeta[]): Promise<void> {
  // The session drizzle's `migrate` hands its dialect (typed without our schema).
  const session = db._.session as unknown as PgSession;
  await new PgDialect().migrate([...migrations], session, { migrationsFolder });
}

/** Applies every migration before `tag` (and not `tag` itself): tests seeding what it forbids. */
export async function migrateBefore(db: Database, tag: string): Promise<void> {
  const cut = migrationMillis(tag);
  await apply(
    db,
    readMigrationFiles({ migrationsFolder }).filter((m) => m.folderMillis < cut),
  );
}

/**
 * Applies every pending migration. Safe to re-run: applied ones are skipped.
 *
 * In two steps around migration B (#295): the migrations before it, then
 * `beforeOneBuildingPerTile`, then the rest. Each step is what drizzle's own
 * `migrate` does, so the journal stays the only record. Without the hook a
 * crowded tile fails the index, loudly: a fresh database (tests) has none.
 */
export async function runMigrations(
  db: Database,
  options: { readonly beforeOneBuildingPerTile?: (db: Database) => Promise<void> } = {},
): Promise<void> {
  await migrateBefore(db, ONE_BUILDING_PER_TILE);
  await options.beforeOneBuildingPerTile?.(db);
  await apply(db, readMigrationFiles({ migrationsFolder }));
}
