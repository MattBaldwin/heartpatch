import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { buildings, mapMembers, maps, squishies, tiles, users } from './schema.js';

const url = inject('testDatabaseUrl');

// Migration 0042 adds the #32 evolution columns, then backfills habitat_since
// by hand so squishies housed before #32 start counting habitat time. This
// runs that last statement on seeded rows.
const migrationSql = readFileSync(join(migrationsFolder, '0042_evolution_branches.sql'), 'utf8');
const statements = migrationSql
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const backfill = statements.at(-1) ?? '';

describe('migration 0042 habitat backfill', () => {
  it('ends with the habitat_since backfill', () => {
    expect(backfill).toMatch(/UPDATE "squishies" SET "habitat_since" = now\(\)/);
  });

  it.skipIf(!url)('starts the clock for housed squishies only (needs DATABASE_URL)', async () => {
    const client = createDbClient(url ?? '', { max: 1, quiet: true });
    try {
      const { db } = client;
      const [user] = await db
        .insert(users)
        .values({
          username: `m0042_${String(process.pid)}_${String(Date.now())}`,
          passwordHash: 'x',
          birthYear: 2013,
        })
        .returning({ id: users.id });
      const [map] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'm0042', timeZone: 'UTC' })
        .returning({ id: maps.id });
      const userId = user?.id ?? '';
      const mapId = map?.id ?? '';
      await db.insert(mapMembers).values({ mapId, userId, role: 'owner' });
      const [tile] = await db
        .insert(tiles)
        .values({ mapId, q: 0, r: 0, terrain: 'meadow' })
        .returning({ id: tiles.id });
      const [home] = await db
        .insert(buildings)
        .values({
          mapId,
          ownerUserId: userId,
          tileId: tile?.id ?? '',
          buildingId: 'test-habitat',
          kind: 'habitat',
          spot: 1,
        })
        .returning({ id: buildings.id });
      const squishy = (habitatBuildingId: string | null) => ({
        mapId,
        ownerUserId: userId,
        speciesId: 'test-squishy',
        element: 'fire' as const,
        feeling: 'cozy' as const,
        habitatBuildingId,
      });
      const [housed, roaming] = await db
        .insert(squishies)
        .values([squishy(home?.id ?? null), squishy(null)])
        .returning({ id: squishies.id });

      // Scoped to this map so other test files' rows are left alone.
      await db.execute(sql.raw(backfill.replace(/;\s*$/, ` AND "map_id" = '${mapId}';`)));

      const rows = await db
        .select({ id: squishies.id, habitatSince: squishies.habitatSince })
        .from(squishies)
        .where(inArray(squishies.mapId, [mapId]));
      const since = (id: string | undefined) => rows.find((r) => r.id === id)?.habitatSince;
      expect(since(housed?.id)).toBeInstanceOf(Date);
      expect(since(roaming?.id)).toBeNull();

      await db.delete(maps).where(inArray(maps.id, [mapId]));
      await db.delete(users).where(inArray(users.id, [userId]));
    } finally {
      await client.close();
    }
  });
});
