import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { ownDatabaseUrl } from '../../tests/own-database.js';

const url = ownDatabaseUrl();

// Migration 0068 adds a partial index on `tile_attacks (map_id) where
// ended_at is null`, expand-only: computer mates' claim guard
// (`openAttackTileIds`) reads a map's running attacks every step, and the
// only other index led by `map_id` also covers every finished attack of the
// season. No data changes. A rollback drops the index.
const migrationSql = readFileSync(join(migrationsFolder, '0068_tile_attacks_open.sql'), 'utf8');

const DOWN = sql`drop index tile_attacks_map_id_open_idx`;

// The shape of `openAttackTileIds` (computer-mates/repo.ts).
const OPEN_ATTACKS = sql`explain (format json)
  select tile_id from tile_attacks
  where map_id = '00000000-0000-0000-0000-000000000001' and ended_at is null`;

type Plan = { 'Index Name'?: string; Plans?: Plan[] };
const indexNames = (plan: Plan): string[] => [
  ...(plan['Index Name'] ? [plan['Index Name']] : []),
  ...(plan.Plans ?? []).flatMap(indexNames),
];

describe('migration 0068 (open tile attacks index)', () => {
  it('adds one partial index and changes no data', () => {
    expect(migrationSql.trim()).toBe(
      'CREATE INDEX "tile_attacks_map_id_open_idx" ON "tile_attacks" USING btree ("map_id") WHERE "tile_attacks"."ended_at" is null;',
    );
  });

  it.skipIf(!url)(
    'serves the open-attacks query and rolls back by dropping it (needs DATABASE_URL)',
    async () => {
      const client = createDbClient(url!, { max: 1, quiet: true });
      const count = async (db: { execute: typeof client.db.execute }) =>
        (
          await db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_indexes
              where tablename = 'tile_attacks' and indexname = 'tile_attacks_map_id_open_idx'
                and indexdef like '%WHERE (ended_at IS NULL)'`,
          )
        )[0]!.n;
      try {
        expect(await count(client.db)).toBe(1);
        await expect(
          client.db.transaction(async (tx) => {
            // The test table holds a few rows at most, where a sequential
            // scan always wins; turning that off shows which index the
            // planner picks.
            await tx.execute(sql`set local enable_seqscan = off`);
            const [row] = await tx.execute<{ 'QUERY PLAN': [{ Plan: Plan }] }>(OPEN_ATTACKS);
            expect(indexNames(row!['QUERY PLAN'][0].Plan)).toEqual([
              'tile_attacks_map_id_open_idx',
            ]);
            await tx.execute(DOWN);
            expect(await count(tx)).toBe(0);
            throw new Error('rollback');
          }),
        ).rejects.toThrow('rollback');
      } finally {
        await client.close();
      }
    },
  );
});
