import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PushKindSchema } from '@heartpatch/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { pushSends, pushSettings, pushSubscriptions, sessions, users } from './schema.js';

const url = inject('testDatabaseUrl');

// Migration 0063 (#726a) is expand only: three new leaf tables for push
// nudges, read and written by nothing yet (the push module is #726b).
const migrationSql = readFileSync(join(migrationsFolder, '0063_push.sql'), 'utf8');

describe('migration 0063 (push nudges)', () => {
  it('only adds tables, keys and indexes', () => {
    const statements = migrationSql.split('--> statement-breakpoint').map((x) => x.trim());
    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE (TABLE|INDEX) "push_|ALTER TABLE "push_\w+" ADD )/);
    }
    // No foreign key to maps: a push row never waits on a patch's lock.
    expect(migrationSql).not.toContain('"maps"');
  });

  it('lists every shared push kind in the send log’s check', () => {
    for (const kind of PushKindSchema.options) expect(migrationSql).toContain(`'${kind}'`);
  });

  it.skipIf(!url)('keeps rows sane and cleans up after logout (needs DATABASE_URL)', async () => {
    const client = createDbClient(url ?? '', { max: 1, quiet: true });
    try {
      const { db } = client;
      const newUser = async (username: string) => {
        const [user] = await db
          .insert(users)
          .values({ username, passwordHash: 'x', birthYear: 2013 })
          .returning({ id: users.id });
        return user?.id ?? '';
      };
      const newSession = async (userId: string, tokenHash: string) => {
        const [session] = await db
          .insert(sessions)
          .values({ userId, tokenHash, expiresAt: new Date('2027-01-01T00:00:00Z') })
          .returning({ id: sessions.id });
        return session?.id ?? '';
      };
      const lee = await newUser('m0063_lee');
      const sam = await newUser('m0063_sam');
      const leeSession = await newSession(lee, 'm0063-lee');
      const samSession = await newSession(sam, 'm0063-sam');
      const device = (endpoint: string, userId = lee, sessionId = leeSession) => ({
        userId,
        sessionId,
        endpoint,
        p256dh: 'key',
        auth: 'auth',
      });

      // One row per endpoint, https only.
      await db.insert(pushSubscriptions).values(device('https://push.example/a'));
      await expect(
        db.insert(pushSubscriptions).values(device('https://push.example/a', sam, samSession)),
      ).rejects.toThrow();
      await expect(
        db.insert(pushSubscriptions).values(device('http://push.example/b')),
      ).rejects.toThrow();
      await expect(
        db.insert(pushSubscriptions).values(device(`https://push.example/${'x'.repeat(2048)}`)),
      ).rejects.toThrow();
      await expect(
        db.insert(pushSubscriptions).values({ ...device('https://push.example/c'), failCount: -1 }),
      ).rejects.toThrow();
      const [row] = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example/a'));
      expect([row?.failCount, row?.lastOkAt, row?.expiresAt]).toEqual([0, null, null]);

      // Settings default every switch on.
      const [settings] = await db.insert(pushSettings).values({ userId: lee }).returning();
      expect([settings?.dusk, settings?.gatherers, settings?.friend, settings?.longNight]).toEqual([
        true,
        true,
        true,
        true,
      ]);

      // The send log claims each nudge once, and knows only the shared kinds.
      const claim = (kind: string, dedupeKey: string) =>
        db.insert(pushSends).values({ userId: lee, kind, dedupeKey, claimedAt: new Date() });
      await claim('dusk', 'map/2026-11-01');
      await expect(claim('dusk', 'map/2026-11-01')).rejects.toThrow();
      await claim('long-night-soon', 'map/2026-11-01');
      await expect(claim('nag', 'map/2026-11-01')).rejects.toThrow();
      await expect(claim('dusk', '')).rejects.toThrow();
      const inserted = await db
        .insert(pushSends)
        .values({ userId: lee, kind: 'dusk', dedupeKey: 'map/2026-11-01', claimedAt: new Date() })
        .onConflictDoNothing()
        .returning({ id: pushSends.id });
      expect(inserted).toEqual([]);

      // Logging out ends the device's nudges; the account's settings and log stay.
      await db.delete(sessions).where(eq(sessions.id, leeSession));
      expect(
        await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, lee)),
      ).toEqual([]);
      expect(await db.select().from(pushSettings).where(eq(pushSettings.userId, lee))).toHaveLength(
        1,
      );
      expect(await db.select().from(pushSends).where(eq(pushSends.userId, lee))).toHaveLength(2);

      // Deleting the account removes the rest.
      await db.delete(users).where(eq(users.id, lee));
      expect(await db.select().from(pushSettings).where(eq(pushSettings.userId, lee))).toEqual([]);
      expect(await db.select().from(pushSends).where(eq(pushSends.userId, lee))).toEqual([]);
      await db.delete(users).where(eq(users.id, sam));
    } finally {
      await client.close();
    }
  });
});
