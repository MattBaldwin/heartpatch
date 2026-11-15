import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { computerMates, maps, users } from './schema.js';

const url = inject('testDatabaseUrl');

// Migration 0064 (#386a) adds computer patch-mates: `users.kind`, nullable
// credentials guarded by a CHECK, a players-only username index, three
// `maps` columns and the `computer_mates` table. No backfill: every existing
// row is a player with a hash and a birth year.
const migrationSql = readFileSync(join(migrationsFolder, '0064_computer_mates.sql'), 'utf8');

/** The plan's down migration (#386 §4), run here to prove it works once mates are gone. */
const DOWN = sql`
  delete from users where kind = 'computer';
  drop table computer_mates;
  alter table maps drop column computer_mates, drop column computer_mates_changed_at,
    drop column keepers_seen_at;
  alter table users drop constraint users_kind_credentials_check;
  drop index users_username_lower_key;
  create unique index users_username_lower_key on users (lower(username));
  alter table users alter column password_hash set not null, alter column birth_year set not null;
  alter table users drop column kind;
  drop type user_kind;
`;

describe('migration 0064 (computer patch-mates)', () => {
  it('backfills nothing and drops no data', () => {
    expect(migrationSql).not.toMatch(/^\s*(UPDATE|DELETE)\b|DROP TABLE|DROP COLUMN/m);
    expect(migrationSql).toContain(`DEFAULT 'player' NOT NULL`);
    expect(migrationSql).toContain(`WHERE "users"."kind" = 'player'`);
  });

  it.skipIf(!url)('guards credentials by kind, and rolls back (needs DATABASE_URL)', async () => {
    const client = createDbClient(url ?? '', { max: 1, quiet: true });
    try {
      const { db } = client;
      const tag = `m0064_${String(process.pid)}`;
      // A player still needs a password and a birth year.
      await expect(
        db.insert(users).values({ username: `${tag}_nopass`, birthYear: 2013 }),
      ).rejects.toThrow();
      await expect(
        db.insert(users).values({ username: `${tag}_noyear`, passwordHash: 'x' }),
      ).rejects.toThrow();
      // A computer mate never has a password.
      await expect(
        db.insert(users).values({ username: `${tag}_bot`, kind: 'computer', passwordHash: 'x' }),
      ).rejects.toThrow();
      // Two patches' Brambles share a name; players stay unique, case-insensitively.
      await db.insert(users).values([
        { username: `${tag}_Bramble`, kind: 'computer' },
        { username: `${tag}_bramble`, kind: 'computer' },
        { username: `${tag}_BRAMBLE`, passwordHash: 'x', birthYear: 2013 },
      ]);
      await expect(
        db.insert(users).values({ username: `${tag}_bramble`, passwordHash: 'x', birthYear: 2013 }),
      ).rejects.toThrow();

      const [map] = await db
        .insert(maps)
        .values({ kind: 'multiplayer', name: 'M0064', timeZone: 'UTC' })
        .returning({ id: maps.id, on: maps.computerMates });
      expect(map!.on).toBe(false);
      const [mate] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, `${tag}_Bramble`));
      await db
        .insert(computerMates)
        .values({ userId: mate!.id, mapId: map!.id, personaId: 'bramble', seed: 's' });
      // One per patch and persona.
      const [other] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, `${tag}_bramble`));
      await expect(
        db
          .insert(computerMates)
          .values({ userId: other!.id, mapId: map!.id, personaId: 'bramble', seed: 's' }),
      ).rejects.toThrow();

      // The down migration works, inside a transaction we roll back.
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(DOWN);
          const [row] = await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from information_schema.tables where table_name = 'computer_mates'`,
          );
          expect(row!.n).toBe(0);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      await db.delete(maps).where(eq(maps.id, map!.id));
      await db.execute(sql`delete from users where username ilike ${`${tag}_%`}`);
    } finally {
      await client.close();
    }
  });
});
