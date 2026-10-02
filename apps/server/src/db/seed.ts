import { GAME_DATA, generateMap, MAP_MAX_PLAYERS } from '@heartpatch/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { mapMembers, maps, tiles, users } from './schema.js';

/**
 * Not an Argon2 hash, so nobody can log in as a seed user. Real hashing
 * arrives with auth (#3), which can give the seed users real passwords.
 */
export const SEED_PASSWORD_HASH = 'seed-placeholder-not-a-real-hash';

export const SEED_USERNAMES = ['pumpkinpal', 'mothmuffin'] as const;
export const SEED_MAP_NAME = 'Seed Patch';

/** Fixed, so every local database gets the same map. Real maps use crypto.randomBytes. */
export const SEED_MAP_SEED = 'seed-patch';

export interface SeedResult {
  created: boolean;
  mapId: string;
  userIds: string[];
}

/**
 * Creates a multiplayer test map with two members (the first is the owner),
 * generated like a real map (`generateMap`, all seats' home bases), with each
 * member holding their home base. Re-running it is a no-op.
 */
export async function seed(db: Database): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ mapId: mapMembers.mapId })
      .from(mapMembers)
      .innerJoin(maps, eq(maps.id, mapMembers.mapId))
      .innerJoin(users, eq(users.id, mapMembers.userId))
      .where(
        and(eq(sql`lower(${users.username})`, SEED_USERNAMES[0]), eq(maps.name, SEED_MAP_NAME)),
      )
      .limit(1);
    if (existing) {
      const members = await tx
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(eq(mapMembers.mapId, existing.mapId))
        .orderBy(asc(mapMembers.role)); // owner first, matching the created result
      return { created: false, mapId: existing.mapId, userIds: members.map((m) => m.userId) };
    }

    const seededUsers = await tx
      .insert(users)
      .values(
        SEED_USERNAMES.map((username) => ({
          username,
          passwordHash: SEED_PASSWORD_HASH,
          birthYear: 2014,
          tutorialStep: null,
          tutorialCompletedAt: new Date(),
        })),
      )
      .returning({ id: users.id });
    const userIds = seededUsers.map((u) => u.id);

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
