import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeKeeperConfig, KEEPER_DATA } from '@heartpatch/shared';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type DbClient } from './client.js';
import { migrationsFolder, runMigrations } from './migrator.js';
import { users } from './schema.js';

const url = inject('testDatabaseUrl');

interface Journal {
  entries: { idx: number; tag: string }[];
}

// #289: the Keeper builder arrives in migration 0035. Every Keeper saved
// before it gets its starting look's skin tone, eyes, brows and mouth and no
// extras, so no Keeper changes. The values are copied into the migration's
// SQL by hand; this ties them to KEEPER_DATA.
describe.skipIf(!url)('migration 0035 on saved Keepers (#289, needs DATABASE_URL)', () => {
  const name = `heartpatch_m0035_${String(process.pid)}_${String(Date.now())}`;
  let admin: DbClient;
  let client: DbClient | undefined;

  beforeAll(async () => {
    admin = createDbClient(url!, { max: 1, quiet: true });
    await admin.db.execute(`create database "${name}"`);
    const dbUrl = new URL(url!);
    dbUrl.pathname = `/${name}`;
    client = createDbClient(dbUrl.href, { max: 1, quiet: true });

    // The migrations up to 0034 only: a copy of the folder with a shorter journal.
    const upTo0034 = mkdtempSync(join(tmpdir(), 'hp-m0035-'));
    try {
      cpSync(migrationsFolder, upTo0034, { recursive: true });
      const journalPath = join(upTo0034, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
      const cut = journal.entries.findIndex((e) => e.tag.startsWith('0035_'));
      expect(cut).toBeGreaterThan(0);
      journal.entries = journal.entries.slice(0, cut);
      writeFileSync(journalPath, JSON.stringify(journal));
      await migrate(client.db, { migrationsFolder: upTo0034 });
    } finally {
      rmSync(upTo0034, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await client?.close();
    await admin.db.execute(`drop database if exists "${name}" with (force)`);
    await admin.close();
  });

  it('fills every saved Keeper from its starting look, so none changes', async () => {
    const db = client!.db;
    const saved = KEEPER_DATA.bases.map((base, i) => ({
      base: base.id,
      hairColor: KEEPER_DATA.hairColors[i % KEEPER_DATA.hairColors.length]!.id,
      eyeColor: base.eyeColor,
      outfit: base.outfit,
      // One picked another hair style; it stays.
      hairstyle: i === 0 ? 'long' : null,
    }));
    const ids: string[] = [];
    for (const [i, keeper] of saved.entries()) {
      const [user] = await db
        .insert(users)
        .values({ username: `m0035_${String(i)}`, passwordHash: 'x', birthYear: 2013 })
        .returning({ id: users.id });
      ids.push(user!.id);
      // Raw SQL: the code schema lists the columns this migration adds.
      await db.execute(
        sql`insert into keepers (user_id, base, hair_color, eye_color, outfit, hairstyle)
            values (${user!.id}, ${keeper.base}, ${keeper.hairColor}, ${keeper.eyeColor},
                    ${keeper.outfit}, ${keeper.hairstyle})`,
      );
    }

    await runMigrations(db);

    const rows = (await db.execute(
      sql`select user_id, base, hair_color, eye_color, outfit, hairstyle,
                 skin_tone, eyes, brows, mouth, extras
          from keepers order by base`,
    )) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(saved.length);
    for (const [i, keeper] of saved.entries()) {
      const row = rows.find((r) => r['user_id'] === ids[i])!;
      const { hairstyle, ...config } = keeper;
      const expected = completeKeeperConfig(config, KEEPER_DATA);
      expect(row, keeper.base).toEqual({
        user_id: ids[i],
        base: expected.base,
        hair_color: expected.hairColor,
        eye_color: expected.eyeColor,
        outfit: expected.outfit,
        hairstyle,
        skin_tone: expected.skinTone,
        eyes: expected.eyes,
        brows: expected.brows,
        mouth: expected.mouth,
        extras: [],
      });
    }
  });
});
