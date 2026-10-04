import {
  GAME_DATA,
  generateMap,
  KEEPER_DATA,
  keeperConfigProblem,
  MAP_MAX_PLAYERS,
} from '@heartpatch/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from './client.js';
import { verifySecret } from '../modules/auth/secrets.js';
import { keepers, mapMembers, maps, tiles, users } from './schema.js';
import {
  SEED_ACCOUNTS,
  SEED_FRESH_USERNAME,
  SEED_MAP_SEED,
  SEED_PASSWORD,
  SEED_USERNAMES,
  seed,
  seedTargetRefusal,
} from './seed.js';

const url = inject('testDatabaseUrl');

describe('seedTargetRefusal', () => {
  const at = (host: string) => `postgres://heartpatch:heartpatch@${host}/heartpatch`;

  it.each(['localhost:5432', 'LOCALHOST', '127.0.0.1:5432', '[::1]:5432', 'db:5432'])(
    'allows the local database at %s',
    (host) => {
      expect(seedTargetRefusal(at(host), false)).toBeNull();
    },
  );

  it.each(['db.example.com', '10.0.0.5:5432', '127.0.0.2', 'play.pumpkinpatchgames.com'])(
    'refuses %s',
    (host) => {
      expect(seedTargetRefusal(at(host), false)).toMatch(/refusing to seed/);
    },
  );

  it('refuses a URL with no host (a socket path) or no URL at all', () => {
    expect(seedTargetRefusal('postgres:///heartpatch?host=/tmp', false)).toMatch(/\(no host\)/);
    expect(seedTargetRefusal('not a url', false)).toMatch(/not a URL/);
  });

  it('allows a remote database only with HP_SEED_ALLOW_REMOTE', () => {
    expect(seedTargetRefusal(at('db.example.com'), true)).toBeNull();
  });
});

describe.skipIf(!url)('seed (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;

  beforeAll(() => {
    client = createDbClient(url!, { max: 2 });
    db = client.db;
  });
  afterAll(() => client.close());

  // Argon2 hashes and checks the seed password several times per test.
  it(
    'creates a test map with 2 users, then does nothing on re-run',
    { timeout: 30_000 },
    async () => {
      const first = await seed(db);
      expect(first.created).toBe(true);
      expect(first.userIds).toHaveLength(2);

      const [map] = await db.select().from(maps).where(eq(maps.id, first.mapId));
      expect(map).toMatchObject({ kind: 'multiplayer', eventSeq: 0 });

      const members = await db
        .select({ role: mapMembers.role, username: users.username, hash: users.passwordHash })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(eq(mapMembers.mapId, first.mapId));
      expect(members.map((m) => m.username).sort()).toEqual([...SEED_USERNAMES].sort());
      expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);

      expect(map?.seed).toBe(SEED_MAP_SEED);
      expect(map?.maxPlayers).toBe(MAP_MAX_PLAYERS);

      // Stored exactly as generateMap made it, with each member holding their home base.
      const generated = generateMap(GAME_DATA, {
        seed: SEED_MAP_SEED,
        playerCount: MAP_MAX_PLAYERS,
      });
      const seededTiles = await db.select().from(tiles).where(eq(tiles.mapId, first.mapId));
      expect(seededTiles).toHaveLength(generated.tiles.length);
      const stored = new Map(seededTiles.map((t) => [`${t.q},${t.r}`, t]));
      for (const t of generated.tiles) {
        expect(stored.get(`${t.q},${t.r}`)).toMatchObject({
          terrain: t.terrain,
          nodeResource: t.nodeResource,
          guardianStrength: t.guardianStrength,
          homeSlot: t.homeSlot,
          ownerUserId: t.homeSlot === null ? null : (first.userIds[t.homeSlot] ?? null),
        });
      }
      const slots = await db
        .select({ userId: mapMembers.userId, homeSlot: mapMembers.homeSlot })
        .from(mapMembers)
        .where(eq(mapMembers.mapId, first.mapId));
      expect(slots).toEqual(
        expect.arrayContaining(first.userIds.map((userId, i) => ({ userId, homeSlot: i }))),
      );

      // Every account logs in with the seed password; the onboarded ones skip
      // the Keeper pick, the cinematic and the tutorial, the fresh one gets all three.
      const accounts = await db
        .select({
          username: users.username,
          hash: users.passwordHash,
          cinematicSeenAt: users.cinematicSeenAt,
          tutorialCompletedAt: users.tutorialCompletedAt,
          tutorialStep: users.tutorialStep,
          keeper: {
            base: keepers.base,
            hairColor: keepers.hairColor,
            eyeColor: keepers.eyeColor,
            outfit: keepers.outfit,
          },
        })
        .from(users)
        .leftJoin(keepers, eq(keepers.userId, users.id))
        .where(
          inArray(
            sql`lower(${users.username})`,
            SEED_ACCOUNTS.map((a) => a.username),
          ),
        );
      expect(accounts).toHaveLength(SEED_ACCOUNTS.length);
      for (const account of accounts) {
        expect(await verifySecret(account.hash, SEED_PASSWORD), account.username).toBe(true);
        expect(account.tutorialStep).toBeNull();
        if (account.username === SEED_FRESH_USERNAME) {
          expect(account).toMatchObject({
            keeper: null,
            cinematicSeenAt: null,
            tutorialCompletedAt: null,
          });
        } else {
          expect(account.cinematicSeenAt).not.toBeNull();
          expect(account.tutorialCompletedAt).not.toBeNull();
          expect(account.keeper).not.toBeNull();
          expect(keeperConfigProblem(account.keeper!, KEEPER_DATA)).toBeNull();
        }
      }
      expect(members.map((m) => m.username)).not.toContain(SEED_FRESH_USERNAME);

      const again = await seed(db);
      // Same ids in the same order (owner first) as when it was created.
      expect(again).toEqual({ ...first, created: false });
      expect(await db.select().from(maps).where(eq(maps.name, map!.name))).toHaveLength(1);
    },
  );
  it(
    'upgrades accounts from an older seed: real password, onboarding skipped',
    {
      timeout: 30_000,
    },
    async () => {
      await seed(db);
      // What a seed from before #28 left behind.
      await db
        .update(users)
        .set({
          passwordHash: 'seed-placeholder-not-a-real-hash',
          cinematicSeenAt: null,
          tutorialCompletedAt: null,
        })
        .where(eq(sql`lower(${users.username})`, SEED_USERNAMES[0]));
      await seed(db);
      const [row] = await db
        .select()
        .from(users)
        .where(eq(sql`lower(${users.username})`, SEED_USERNAMES[0]));
      expect(await verifySecret(row!.passwordHash, SEED_PASSWORD)).toBe(true);
      expect(row!.cinematicSeenAt).not.toBeNull();
      expect(row!.tutorialCompletedAt).not.toBeNull();
    },
  );
});
