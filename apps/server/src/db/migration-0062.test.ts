import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LONG_NIGHT_RULES } from '@heartpatch/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { longNights, maps } from './schema.js';

const url = inject('testDatabaseUrl');

// Migration 0062 (#727a) is expand only: `maps.long_night_weekday` with a
// column default (every older patch reads Saturday, owner decision Q5; no
// backfill) and the new `long_nights` table, read by nothing yet.
const migrationSql = readFileSync(join(migrationsFolder, '0062_long_night.sql'), 'utf8');

describe('migration 0062 (the Long Night)', () => {
  it('gives every patch the rules’ default weekday, with no backfill', () => {
    expect(migrationSql).toContain(
      `ALTER TABLE "maps" ADD COLUMN "long_night_weekday" smallint DEFAULT ${String(LONG_NIGHT_RULES.defaultWeekday)};`,
    );
    expect(maps.longNightWeekday.default).toBe(LONG_NIGHT_RULES.defaultWeekday);
    // Expand only: no statement rewrites or drops anything.
    const statements = migrationSql.split('--> statement-breakpoint').map((x) => x.trim());
    for (const statement of statements) expect(statement).toMatch(/^(CREATE|ALTER TABLE \S+ ADD) /);
  });

  it.skipIf(!url)('keeps weekdays and Gap windows sane (needs DATABASE_URL)', async () => {
    const client = createDbClient(url ?? '', { max: 1, quiet: true });
    try {
      const { db } = client;
      const [map] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'm0062', timeZone: 'UTC' })
        .returning({ id: maps.id, longNightWeekday: maps.longNightWeekday });
      const mapId = map?.id ?? '';
      expect(map?.longNightWeekday).toBe(6);

      const setWeekday = (longNightWeekday: number | null) =>
        db.update(maps).set({ longNightWeekday }).where(eq(maps.id, mapId));
      await setWeekday(0);
      await setWeekday(null);
      await expect(setWeekday(7)).rejects.toThrow();
      await expect(setWeekday(-1)).rejects.toThrow();

      const strikeAt = new Date('2026-10-31T23:30:00Z');
      const closesAt = new Date('2026-11-01T23:30:00Z');
      const row = (night: string, over: Partial<typeof longNights.$inferInsert> = {}) => ({
        mapId,
        night,
        ranAt: new Date('2026-10-31T23:00:00Z'),
        strikeAt,
        held: true,
        seed: 'seed',
        contentHash: 'hash',
        ...over,
      });
      await db
        .insert(longNights)
        .values(row('2026-10-31', { gapOpensAt: strikeAt, gapClosesAt: closesAt }));
      await db.insert(longNights).values(row('2026-11-07', { held: false }));
      // One row a night, a Gap only after a hold, and both ends or neither.
      await expect(db.insert(longNights).values(row('2026-10-31'))).rejects.toThrow();
      await expect(
        db
          .insert(longNights)
          .values(row('2026-11-14', { held: false, gapOpensAt: strikeAt, gapClosesAt: closesAt })),
      ).rejects.toThrow();
      await expect(
        db.insert(longNights).values(row('2026-11-21', { gapOpensAt: strikeAt })),
      ).rejects.toThrow();
      await expect(
        db
          .insert(longNights)
          .values(row('2026-11-28', { gapOpensAt: closesAt, gapClosesAt: strikeAt })),
      ).rejects.toThrow();

      const [saved] = await db
        .select({ outcomes: longNights.outcomes })
        .from(longNights)
        .where(and(eq(longNights.mapId, mapId), eq(longNights.night, '2026-11-07')));
      expect(saved?.outcomes).toEqual([]);

      // The rows go with their patch.
      await db.delete(maps).where(eq(maps.id, mapId));
      expect(await db.select().from(longNights).where(eq(longNights.mapId, mapId))).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
