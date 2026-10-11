import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { createDbClient } from './client.js';
import { migrationsFolder } from './migrator.js';
import { keepers, users } from './schema.js';

const url = inject('testDatabaseUrl');

// The face and body migration (#372) fills both from each row's base, whose
// face shape and body type share its id, so no Keeper changes. This runs its
// backfill on rows shaped as before it (no face or body yet).
const file = readdirSync(migrationsFolder).find((f) => f.endsWith('_keeper_face_body.sql'));
const statements = readFileSync(join(migrationsFolder, file ?? 'missing.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe('the keeper face and body migration (#372)', () => {
  it('adds the two columns, fills them from the base, then requires them', () => {
    expect(statements.map((s) => s.replace(/^(?:--.*\n)*/, ''))).toEqual([
      'ALTER TABLE "keepers" ADD COLUMN "face" text;',
      'ALTER TABLE "keepers" ADD COLUMN "body" text;',
      'UPDATE "keepers" SET "face" = "base", "body" = "base";',
      'ALTER TABLE "keepers" ALTER COLUMN "face" SET NOT NULL;',
      'ALTER TABLE "keepers" ALTER COLUMN "body" SET NOT NULL;',
    ]);
  });

  it.skipIf(!url)('fills every saved Keeper from its base (needs DATABASE_URL)', async () => {
    const client = createDbClient(url!, { max: 1, quiet: true });
    const tag = `${String(process.pid)}_${String(Date.now())}`;
    try {
      const { db } = client;
      // The table as it was before: in a transaction that's rolled back, so
      // the migrated schema the other tests use is untouched.
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE "keepers" DROP COLUMN "face", DROP COLUMN "body"`);
          const ids = (
            await tx
              .insert(users)
              .values(
                ['pip', 'rowan'].map((_, i) => ({
                  username: `mfb_${tag}_${String(i)}`,
                  passwordHash: 'x',
                  birthYear: 2013,
                })),
              )
              .returning({ id: users.id })
          ).map((r) => r.id);
          for (const [i, base] of ['pip', 'rowan'].entries()) {
            await tx.execute(sql`
              INSERT INTO "keepers"
                ("user_id", "base", "hair_color", "eye_color", "outfit",
                 "skin_tone", "eyes", "brows", "mouth")
              VALUES (${ids[i]}, ${base}, 'honey', 'sky', 'sunflower',
                'tone-1', 'round', 'arched', 'smile')`);
          }
          for (const statement of statements) await tx.execute(sql.raw(statement));
          const rows = await tx
            .select({ base: keepers.base, face: keepers.face, body: keepers.body })
            .from(keepers)
            .where(inArray(keepers.userId, ids));
          expect(rows.sort((a, b) => a.base.localeCompare(b.base))).toEqual([
            { base: 'pip', face: 'pip', body: 'pip' },
            { base: 'rowan', face: 'rowan', body: 'rowan' },
          ]);
          throw new Rollback();
        })
        .catch((err: unknown) => {
          if (!(err instanceof Rollback)) throw err;
        });
    } finally {
      await client.close();
    }
  });
});

class Rollback extends Error {}
