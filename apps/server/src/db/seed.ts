import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { mapMembers, maps, tiles, users } from './schema.js';

/**
 * Not an Argon2 hash, so nobody can log in as a seed user. Real hashing
 * arrives with auth (#3), which can give the seed users real passwords.
 */
export const SEED_PASSWORD_HASH = 'seed-placeholder-not-a-real-hash';

export const SEED_USERNAMES = ['pumpkinpal', 'mothmuffin'] as const;
export const SEED_MAP_NAME = 'Seed Patch';

const SEED_MAP_RADIUS = 2; // TUNE: 19 tiles; enough to poke at locally
// Placeholder ids until the shared terrain table (#8) lands; terrain is plain text.
const SEED_TERRAIN = ['meadow', 'forest', 'hills'] as const;

export interface SeedResult {
  created: boolean;
  mapId: string;
  userIds: string[];
}

/**
 * Creates a multiplayer test map with two members (the first is the owner)
 * and a small hex of neutral tiles. Re-running it is a no-op.
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
        .where(eq(mapMembers.mapId, existing.mapId));
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

    const [map] = await tx
      .insert(maps)
      .values({ kind: 'multiplayer', name: SEED_MAP_NAME, timeZone: 'America/New_York' })
      .returning({ id: maps.id });
    if (!map) throw new Error('seed: map insert returned no row');

    await tx
      .insert(mapMembers)
      .values(
        userIds.map(
          (userId, i) => ({ mapId: map.id, userId, role: i === 0 ? 'owner' : 'member' }) as const,
        ),
      );

    await tx.insert(tiles).values(
      hexesWithin(SEED_MAP_RADIUS).map(({ q, r }, i) => ({
        mapId: map.id,
        q,
        r,
        terrain: SEED_TERRAIN[i % SEED_TERRAIN.length] ?? 'meadow',
        ownerUserId: null,
      })),
    );

    return { created: true, mapId: map.id, userIds };
  });
}

/** Axial coords within `radius` of the origin. Seed-only; real map generation uses shared hex code. */
function hexesWithin(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}
