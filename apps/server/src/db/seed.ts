import { GAME_DATA, generateMap, MAP_MAX_PLAYERS, type KeeperConfig } from '@heartpatch/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { hashSecret } from '../modules/auth/secrets.js';
import type { Database } from './client.js';
import { keepers, mapMembers, maps, tiles, users } from './schema.js';

/**
 * Every seed account's password. Dev and local playtests only: `cli.ts`
 * refuses to seed with NODE_ENV=production, so it never reaches the real
 * server (docs/DEPLOY.md, "Playtesting").
 */
export const SEED_PASSWORD = 'squishy-secret';

/** What seeds before #28 stored instead of a hash; a re-run gives those rows the real password. */
const LEGACY_PASSWORD_HASH = 'seed-placeholder-not-a-real-hash';

export interface SeedAccount {
  readonly username: string;
  /** Null for the fresh account: it picks its Keeper after logging in. */
  readonly keeper: KeeperConfig | null;
  /** Cinematic seen and tutorial done, so it lands straight in the lobby. */
  readonly onboarded: boolean;
}

/**
 * The seed accounts (docs/DEPLOY.md, "Playtesting"):
 * - `pumpkinpal` and `mothmuffin` skip onboarding: a Keeper, the opening
 *   cinematic seen and the tutorial done. They share Seed Patch (owner first).
 * - `newsprout` is fresh: no Keeper, no cinematic, no tutorial, no patch, so
 *   logging in plays the whole first session (Keeper, story, Sprout).
 */
export const SEED_ACCOUNTS = [
  {
    username: 'pumpkinpal',
    keeper: { base: 'clover', hairColor: 'ginger', eyeColor: 'leaf', outfit: 'pumpkin' },
    onboarded: true,
  },
  {
    username: 'mothmuffin',
    keeper: { base: 'wren', hairColor: 'lilac', eyeColor: 'violet', outfit: 'lavender' },
    onboarded: true,
  },
  { username: 'newsprout', keeper: null, onboarded: false },
] as const satisfies readonly SeedAccount[];

/** Seed Patch's members, owner first. */
export const SEED_USERNAMES = ['pumpkinpal', 'mothmuffin'] as const;
/** The account that goes through the whole onboarding. */
export const SEED_FRESH_USERNAME = 'newsprout';
export const SEED_MAP_NAME = 'Seed Patch';

/** Fixed, so every local database gets the same map. Real maps use crypto.randomBytes. */
export const SEED_MAP_SEED = 'seed-patch';

export interface SeedResult {
  created: boolean;
  mapId: string;
  /** Seed Patch's members, owner first. */
  userIds: string[];
}

/**
 * Creates the seed accounts and a multiplayer test map with two of them as
 * members (the first is the owner), generated like a real map
 * (`generateMap`, all seats' home bases), with each member holding their home
 * base. Re-running it adds only what's missing and never resets a player's
 * progress; `created` says whether the map was made this time.
 */
export async function seed(db: Database): Promise<SeedResult> {
  const passwordHash = await hashSecret(SEED_PASSWORD);
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .insert(users)
      .values(
        SEED_ACCOUNTS.map((a) => ({
          username: a.username,
          passwordHash,
          birthYear: 2014,
          timeZone: 'America/New_York',
          tutorialStep: null,
          tutorialCompletedAt: a.onboarded ? now : null,
          cinematicSeenAt: a.onboarded ? now : null,
        })),
      )
      .onConflictDoNothing();
    const accounts = await tx
      .select({ id: users.id, username: sql<string>`lower(${users.username})` })
      .from(users)
      .where(
        inArray(
          sql`lower(${users.username})`,
          SEED_ACCOUNTS.map((a) => a.username),
        ),
      );
    const idOf = (username: string): string => {
      const account = accounts.find((a) => a.username === username);
      if (!account) throw new Error(`seed: no user row for ${username}`);
      return account.id;
    };

    // Rows from an older seed: give them the real password and skip
    // onboarding where they should (already-set times stay).
    await tx
      .update(users)
      .set({ passwordHash })
      .where(
        and(
          inArray(
            users.id,
            accounts.map((a) => a.id),
          ),
          eq(users.passwordHash, LEGACY_PASSWORD_HASH),
        ),
      );
    const onboardedIds = SEED_ACCOUNTS.filter((a) => a.onboarded).map((a) => idOf(a.username));
    await tx
      .update(users)
      .set({ cinematicSeenAt: now })
      .where(and(inArray(users.id, onboardedIds), isNull(users.cinematicSeenAt)));
    await tx
      .update(users)
      .set({ tutorialCompletedAt: now })
      .where(and(inArray(users.id, onboardedIds), isNull(users.tutorialCompletedAt)));

    // A Keeper for each onboarded account; one picked in the game stays.
    await tx
      .insert(keepers)
      .values(
        SEED_ACCOUNTS.flatMap((a) =>
          a.keeper === null ? [] : [{ userId: idOf(a.username), ...a.keeper }],
        ),
      )
      .onConflictDoNothing();

    const [existing] = await tx
      .select({ mapId: mapMembers.mapId })
      .from(mapMembers)
      .innerJoin(maps, eq(maps.id, mapMembers.mapId))
      .where(and(eq(mapMembers.userId, idOf(SEED_USERNAMES[0])), eq(maps.name, SEED_MAP_NAME)))
      .limit(1);
    if (existing) {
      const members = await tx
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(eq(mapMembers.mapId, existing.mapId))
        .orderBy(asc(mapMembers.role)); // owner first, matching the created result
      return { created: false, mapId: existing.mapId, userIds: members.map((m) => m.userId) };
    }

    const userIds = SEED_USERNAMES.map(idOf);
    const generated = generateMap(GAME_DATA, {
      seed: SEED_MAP_SEED,
      playerCount: MAP_MAX_PLAYERS,
    });
    const [map] = await tx
      .insert(maps)
      .values({
        kind: 'multiplayer',
        name: SEED_MAP_NAME,
        timeZone: 'America/New_York',
        seed: SEED_MAP_SEED,
        maxPlayers: MAP_MAX_PLAYERS,
      })
      .returning({ id: maps.id });
    if (!map) throw new Error('seed: map insert returned no row');

    // Member i holds home slot i.
    await tx
      .insert(mapMembers)
      .values(
        userIds.map(
          (userId, i) =>
            ({ mapId: map.id, userId, role: i === 0 ? 'owner' : 'member', homeSlot: i }) as const,
        ),
      );

    await tx.insert(tiles).values(
      generated.tiles.map((t) => ({
        mapId: map.id,
        q: t.q,
        r: t.r,
        terrain: t.terrain,
        nodeResource: t.nodeResource,
        guardianStrength: t.guardianStrength,
        homeSlot: t.homeSlot,
        ownerUserId: t.homeSlot === null ? null : (userIds[t.homeSlot] ?? null),
      })),
    );

    return { created: true, mapId: map.id, userIds };
  });
}
