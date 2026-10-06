import type { DefenseStance, MapRole, PublicKeeper, PublicTile, PvpMode } from '@heartpatch/shared';
import { and, asc, count, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  gatherJobs,
  inviteCodes,
  joinRequests,
  keepers,
  mapMembers,
  maps,
  outfits,
  squishies,
  tileAttacks,
  tileDefenders,
  tiles,
  users,
} from '../../db/schema.js';
import { keeperColumns, keeperFromRow } from '../keepers/repo.js';
import { titleName } from '../milestones/tracks.js';
import { squishyAtWork } from '../jobs/repo.js';
import { squishyOnWatch } from '../territory/repo.js';
import { WORN, wornOf } from '../wardrobe/repo.js';

export interface UserRef {
  id: string;
  username: string;
}

/** A generated tile to store with a new map (`MapTile` from `generateMap`). */
export interface NewTile {
  q: number;
  r: number;
  terrain: string;
  nodeResource: string | null;
  guardianStrength: number | null;
  homeSlot: number | null;
}

/** A tile for the map view, before the service makes it a `PublicTile`. */
export type TileViewRow = Omit<PublicTile, 'buildings' | 'guardianHint'> & {
  /** `tiles.guardian_strength`. Secret: it picks the guardian tier (tech spec §8). */
  guardianStrength: number | null;
};

export interface MapRow {
  id: string;
  kind: 'multiplayer' | 'tutorial';
  name: string;
  timeZone: string;
  pvpMode: PvpMode;
  maxPlayers: number;
  /** The last event seq committed for this map (`maps.event_seq`). */
  eventSeq: number;
}

export interface MembershipRow {
  role: MapRole;
  status: 'active' | 'removed';
  homeSlot: number | null;
}

/** The member row as `lockMember` returns it. */
export interface LockedMemberRow {
  joinedAt: Date;
  /** The defense stance (#16). */
  defenseStance: DefenseStance;
  /** The starter pick's squishy; null until they pick (`map_members.starter_squishy_id`). */
  starterSquishyId: string | null;
}

export interface MapSummaryRow {
  id: string;
  name: string;
  role: MapRole;
  owner: UserRef;
  memberCount: number;
  maxPlayers: number;
  pvpMode: PvpMode;
  /** Join requests waiting on the owner (#144); 0 unless this row is the owner's. */
  pendingRequests: number;
}

export interface JoinRequestRow {
  id: string;
  mapName: string;
  owner: UserRef;
  createdAt: Date;
}

export interface MemberRow {
  user: UserRef;
  role: MapRole;
  homeSlot: number | null;
  joinedAt: Date;
  /** Shown to the other members (#42) with what it wears (#43); null until they pick one. */
  keeper: PublicKeeper | null;
  /** The milestone title they wear (#44), by name; null for none. */
  title: string | null;
}

export interface PendingRequestRow {
  id: string;
  user: UserRef;
  createdAt: Date;
}

/**
 * Map storage. Plain queries; the service decides the rules and runs each
 * command in one transaction with `transaction`.
 */
export interface MapsRepo {
  /**
   * Runs `fn` in one transaction (`withTransaction`): `repo` is this repo on
   * that transaction, and `tx` builds other modules' repos on it too
   * (`createAuthRepo(tx)`), so all their writes commit together.
   */
  transaction: <T>(fn: (repo: MapsTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /**
   * Runs `fn`'s reads in one read-only `repeatable read` transaction
   * (`withTransaction`), so they all see the same committed moment: a map,
   * its tiles and its `event_seq` that agree with each other. Top level only
   * (Postgres can't change the isolation of a transaction already running).
   */
  snapshot: <T>(fn: (repo: MapsRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** `users.tutorial_completed_at` (null = not finished). */
  tutorialCompletedAt: (userId: string) => Promise<Date | null>;
  findUser: (userId: string) => Promise<UserRef | null>;
  /**
   * Row-locks the player's account until commit. Taken by commands that
   * change which maps a player is in, and by owner password resets, so a
   * reset's "are all their maps yours?" check can't race a join.
   */
  lockUser: (userId: string) => Promise<void>;

  insertMap: (map: {
    name: string;
    timeZone: string;
    seed: string;
    maxPlayers: number;
  }) => Promise<{ id: string; pvpMode: PvpMode }>;
  insertTiles: (mapId: string, rows: readonly NewTile[]) => Promise<void>;
  findMap: (mapId: string) => Promise<MapRow | null>;
  /** True if the mode changed. */
  setPvpMode: (mapId: string, pvpMode: PvpMode) => Promise<boolean>;
  /** Sorted by `q`, then `r`. */
  /**
   * Every tile; the service adds each tile's buildings (#18) and guardian
   * hint, and drops `guardianStrength` (secret, tech spec §8).
   */
  listTiles: (mapId: string) => Promise<TileViewRow[]>;
  /** Gives the player every tile of a home slot; returns those tiles. */
  claimHomeTiles: (
    mapId: string,
    homeSlot: number,
    userId: string,
  ) => Promise<{ q: number; r: number }[]>;
  /** Sends all of a player's tiles back to neutral (squishies on watch go home); returns how many. */
  releaseTiles: (mapId: string, userId: string) => Promise<number>;

  /** The player's membership in any status, or null if they never joined. */
  membership: (mapId: string, userId: string) => Promise<MembershipRow | null>;
  /** Adds the player, or reactivates a removed player's row. */
  upsertMember: (member: {
    mapId: string;
    userId: string;
    role: MapRole;
    homeSlot: number | null;
    joinedAt: Date;
  }) => Promise<void>;
  /** Archives the membership (`status = removed`, tech spec §4). */
  archiveMember: (mapId: string, userId: string) => Promise<void>;
  /**
   * The per-map "seats" lock: row-locks the owner's member row until commit.
   * Commands that add or remove members take it first, so they run one at a
   * time per map. `no key update` still lets tiles and squishies reference it.
   */
  lockSeats: (mapId: string) => Promise<void>;
  /**
   * "A member row locked to check it" (tech spec §7): row-locks the player's
   * active membership (`for no key update`, like the seats lock) until
   * commit, or returns null if they aren't an active member. Posting guards
   * and challenges (territory) and the starter pick take it, so a player's
   * guard changes, a defender's daily loss cap and two starter picks each run
   * one at a time.
   */
  lockMember: (mapId: string, userId: string) => Promise<LockedMemberRow | null>;
  /** Home slots held by active members. Run after `lockSeats` for an exact answer. */
  activeHomeSlots: (mapId: string) => Promise<{ count: number; slots: Set<number> }>;
  /** Active members, owner first, then by join time. */
  listMembers: (mapId: string) => Promise<MemberRow[]>;
  owner: (mapId: string) => Promise<UserRef | null>;
  /**
   * A Tutorial Glade's player (its owner, whatever their membership's
   * status), or null if `mapId` isn't a tutorial map. A plain read.
   */
  tutorialPlayerOf: (mapId: string) => Promise<string | null>;
  /** My active multiplayer maps, oldest membership first. */
  listMyMaps: (userId: string) => Promise<MapSummaryRow[]>;
  /**
   * How many multiplayer maps the player is an active member of that aren't
   * owned by `ownerId`. Tutorial maps don't count (decision D).
   */
  countMapsOwnedByOthers: (userId: string, ownerId: string) => Promise<number>;

  /** Throws a unique violation (see `isUniqueViolation`) if the code is taken. */
  insertInvite: (invite: {
    mapId: string;
    code: string;
    createdByUserId: string;
    expiresAt: Date;
  }) => Promise<void>;
  revokeInvites: (mapId: string, now: Date) => Promise<void>;
  /** The map's unrevoked, unexpired code, if any. */
  liveInvite: (mapId: string, now: Date) => Promise<{ code: string; expiresAt: Date } | null>;
  /** An unrevoked, unexpired code on a multiplayer map. */
  findLiveInviteByCode: (
    code: string,
    now: Date,
  ) => Promise<{ id: string; mapId: string; mapName: string } | null>;

  findPendingRequest: (
    mapId: string,
    userId: string,
  ) => Promise<{ id: string; createdAt: Date } | null>;
  /** Throws a unique violation if the player already has a pending request here. */
  insertJoinRequest: (request: {
    mapId: string;
    userId: string;
    inviteCodeId: string;
  }) => Promise<{ id: string; createdAt: Date }>;
  /** Row-locks a request on this map until commit. */
  lockJoinRequest: (
    mapId: string,
    requestId: string,
  ) => Promise<{ userId: string; status: 'pending' | 'approved' | 'denied' } | null>;
  /** Answers a pending request; false if it isn't pending (or isn't on this map). */
  decideJoinRequest: (input: {
    mapId: string;
    requestId: string;
    status: 'approved' | 'denied';
    now: Date;
  }) => Promise<boolean>;
  listPendingRequests: (mapId: string) => Promise<PendingRequestRow[]>;
  listMyPendingRequests: (userId: string) => Promise<JoinRequestRow[]>;
}

/** The repo inside `transaction`: the only place game events can be written. */
export interface MapsTxRepo extends MapsRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

/**
 * The `map_members` condition for an active member of `mapId`: one player's
 * membership, or with `userId` left out, every active member. One definition,
 * so "active member" can't drift between the modules that check it. Either
 * may be another table's column, for a join (Hollow: a squishy's owner).
 */
export const activeMember = (mapId: string | AnyPgColumn, userId?: string | AnyPgColumn) =>
  and(
    eq(mapMembers.mapId, mapId),
    userId === undefined ? undefined : eq(mapMembers.userId, userId),
    eq(mapMembers.status, 'active'),
  );

const owners = alias(mapMembers, 'owners');
const ownerUsers = alias(users, 'owner_users');

/** Active members per map, as a correlated subquery. */
const activeMemberCount = sql<number>`(
  select count(*)::int from ${mapMembers} as m
  where m.map_id = ${maps.id} and m.status = 'active'
)`;

/** Join requests waiting on the owner, for the owner's own rows only (#144). */
const pendingRequestCount = sql<number>`(
  select case when ${mapMembers.role} = 'owner' then count(*)::int else 0 end
  from ${joinRequests} as r
  where r.map_id = ${maps.id} and r.status = 'pending'
)`;

export function createMapsRepo(db: Executor): MapsRepo {
  return queries(db);
}

function createMapsTxRepo(tx: Transaction): MapsTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): MapsRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createMapsTxRepo(tx), tx)),

    snapshot: (fn) =>
      withTransaction(db, async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read, read only`);
        return fn(queries(tx), tx);
      }),

    tutorialCompletedAt: async (userId) => {
      const [row] = await db
        .select({ at: users.tutorialCompletedAt })
        .from(users)
        .where(eq(users.id, userId));
      return row?.at ?? null;
    },

    findUser: async (userId) => {
      const [row] = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, userId));
      return row ?? null;
    },

    lockUser: async (userId) => {
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('no key update');
    },

    insertMap: async (map) => {
      const [row] = await db
        .insert(maps)
        .values({ kind: 'multiplayer', ...map })
        .returning({ id: maps.id, pvpMode: maps.pvpMode });
      if (!row) throw new Error('insertMap: insert returned no row');
      return row;
    },

    insertTiles: async (mapId, rows) => {
      await db.insert(tiles).values(rows.map((t) => ({ mapId, ...t })));
    },

    findMap: async (mapId) => {
      const [row] = await db
        .select({
          id: maps.id,
          kind: maps.kind,
          name: maps.name,
          timeZone: maps.timeZone,
          pvpMode: maps.pvpMode,
          maxPlayers: maps.maxPlayers,
          eventSeq: maps.eventSeq,
        })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row ?? null;
    },

    setPvpMode: async (mapId, pvpMode) => {
      const changed = await db
        .update(maps)
        .set({ pvpMode })
        .where(and(eq(maps.id, mapId), ne(maps.pvpMode, pvpMode)))
        .returning({ id: maps.id });
      return changed.length > 0;
    },

    listTiles: async (mapId) => {
      const rows = await db
        .select({
          q: tiles.q,
          r: tiles.r,
          terrain: tiles.terrain,
          ownerUserId: tiles.ownerUserId,
          nodeResource: tiles.nodeResource,
          homeSlot: tiles.homeSlot,
          guardianStrength: tiles.guardianStrength,
          gatheringReadyAt: gatherJobs.readyAt,
          // The raid cooldown (#15): the latest tile battle's, past or not.
          cooldownUntil: sql<string | null>`(
            select max(${tileAttacks.cooldownUntil}) from ${tileAttacks}
            where ${tileAttacks.tileId} = ${tiles.id}
          )`,
          // Squishies posted here that are on watch (#15) and not in the Hollow.
          // A squishy has one post at most, so "on watch" means this tile is
          // still its owner's.
          defenders: sql<number>`(
            select count(*) from ${tileDefenders}
            join ${squishies} on ${squishies.id} = ${tileDefenders.squishyId}
            where ${tileDefenders.tileId} = ${tiles.id}
              and ${squishyOnWatch()}
              and ${squishies.state} = 'active'
          )::int`.mapWith(Number),
          // Squishy gatherers at work here (jobs' `squishyAtWork`), not in the Hollow.
          workers: sql<number>`(
            select count(*) from ${squishies}
            where ${squishies.workTileId} = ${tiles.id}
              and ${squishyAtWork()}
              and ${squishies.state} = 'active'
          )::int`.mapWith(Number),
        })
        .from(tiles)
        // "Gathering here" (#17): only the tile owner's own gather counts.
        .leftJoin(
          gatherJobs,
          and(
            eq(gatherJobs.tileId, tiles.id),
            eq(gatherJobs.status, 'active'),
            eq(gatherJobs.userId, tiles.ownerUserId),
          ),
        )
        .where(eq(tiles.mapId, mapId))
        .orderBy(asc(tiles.q), asc(tiles.r));
      return rows.map(({ gatheringReadyAt, cooldownUntil, ...tile }) => ({
        ...tile,
        gathering: gatheringReadyAt ? { readyAt: gatheringReadyAt.toISOString() } : null,
        cooldownUntil: cooldownUntil === null ? null : new Date(cooldownUntil).toISOString(),
      }));
    },

    claimHomeTiles: async (mapId, homeSlot, userId) =>
      db
        .update(tiles)
        .set({ ownerUserId: userId })
        .where(and(eq(tiles.mapId, mapId), eq(tiles.homeSlot, homeSlot)))
        .returning({ q: tiles.q, r: tiles.r }),

    releaseTiles: async (mapId, userId) => {
      // Tech spec §7 "Lock order": the tiles (in id order), then their
      // defenders, like a capture. A bare multi-row UPDATE locks in scan order.
      await db
        .select({ id: tiles.id })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId)))
        .orderBy(asc(tiles.id))
        .for('no key update');
      // Squishies on watch there go home (#15): the land isn't theirs to guard now.
      await db.delete(tileDefenders).where(
        inArray(
          tileDefenders.tileId,
          db
            .select({ id: tiles.id })
            .from(tiles)
            .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId))),
        ),
      );
      const released = await db
        .update(tiles)
        .set({ ownerUserId: null })
        .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId)))
        .returning({ id: tiles.id });
      return released.length;
    },

    membership: async (mapId, userId) => {
      const [row] = await db
        .select({ role: mapMembers.role, status: mapMembers.status, homeSlot: mapMembers.homeSlot })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
      return row ?? null;
    },

    upsertMember: async (member) => {
      await db
        .insert(mapMembers)
        .values(member)
        .onConflictDoUpdate({
          target: [mapMembers.mapId, mapMembers.userId],
          set: {
            role: member.role,
            status: 'active',
            homeSlot: member.homeSlot,
            joinedAt: member.joinedAt,
          },
        });
    },

    archiveMember: async (mapId, userId) => {
      await db
        .update(mapMembers)
        .set({ status: 'removed' })
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
    },

    lockSeats: async (mapId) => {
      await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.role, 'owner')))
        .for('no key update');
    },

    lockMember: async (mapId, userId) => {
      const [row] = await db
        .select({
          joinedAt: mapMembers.joinedAt,
          defenseStance: mapMembers.defenseStance,
          starterSquishyId: mapMembers.starterSquishyId,
        })
        .from(mapMembers)
        .where(activeMember(mapId, userId))
        .for('no key update');
      return row ?? null;
    },

    activeHomeSlots: async (mapId) => {
      const rows = await db
        .select({ homeSlot: mapMembers.homeSlot })
        .from(mapMembers)
        .where(activeMember(mapId));
      const slots = new Set<number>();
      for (const row of rows) if (row.homeSlot !== null) slots.add(row.homeSlot);
      return { count: rows.length, slots };
    },

    listMembers: async (mapId) => {
      const rows = await db
        .select({
          user: { id: users.id, username: users.username },
          role: mapMembers.role,
          homeSlot: mapMembers.homeSlot,
          joinedAt: mapMembers.joinedAt,
          // Drizzle makes a left-joined object null when every column is null.
          keeper: keeperColumns,
          // The milestone title on their profile card (#44).
          titleId: keepers.titleId,
          // What the Keeper wears (#43): the worn outfit row, if they ever dressed.
          wearing: outfits.wearing,
        })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .leftJoin(keepers, eq(keepers.userId, mapMembers.userId))
        .leftJoin(outfits, and(eq(outfits.userId, mapMembers.userId), eq(outfits.preset, WORN)))
        .where(activeMember(mapId))
        // 'owner' is the enum's first value, so it sorts first.
        .orderBy(asc(mapMembers.role), asc(mapMembers.joinedAt), asc(users.id));
      return rows.map(({ wearing, titleId, ...row }) => ({
        ...row,
        keeper: row.keeper ? { ...keeperFromRow(row.keeper), wearing: wornOf(wearing) } : null,
        title: titleName(titleId),
      }));
    },

    owner: async (mapId) => {
      const [row] = await db
        .select({ id: users.id, username: users.username })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.role, 'owner')));
      return row ?? null;
    },

    tutorialPlayerOf: async (mapId) => {
      const [row] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .innerJoin(maps, eq(maps.id, mapMembers.mapId))
        .where(
          and(eq(mapMembers.mapId, mapId), eq(mapMembers.role, 'owner'), eq(maps.kind, 'tutorial')),
        );
      return row?.userId ?? null;
    },

    listMyMaps: async (userId) =>
      db
        .select({
          id: maps.id,
          name: maps.name,
          role: mapMembers.role,
          owner: { id: ownerUsers.id, username: ownerUsers.username },
          memberCount: activeMemberCount,
          maxPlayers: maps.maxPlayers,
          pvpMode: maps.pvpMode,
          pendingRequests: pendingRequestCount,
        })
        .from(mapMembers)
        .innerJoin(maps, eq(maps.id, mapMembers.mapId))
        .innerJoin(owners, and(eq(owners.mapId, maps.id), eq(owners.role, 'owner')))
        .innerJoin(ownerUsers, eq(ownerUsers.id, owners.userId))
        .where(
          and(
            eq(mapMembers.userId, userId),
            eq(mapMembers.status, 'active'),
            eq(maps.kind, 'multiplayer'),
          ),
        )
        .orderBy(asc(mapMembers.joinedAt), asc(maps.id)),

    countMapsOwnedByOthers: async (userId, ownerId) => {
      const theirMaps = db
        .select({ mapId: mapMembers.mapId })
        .from(mapMembers)
        .innerJoin(maps, eq(maps.id, mapMembers.mapId))
        .where(
          and(
            eq(mapMembers.userId, userId),
            eq(mapMembers.status, 'active'),
            eq(maps.kind, 'multiplayer'),
          ),
        );
      const [row] = await db
        .select({ n: count() })
        .from(mapMembers)
        .where(
          and(
            inArray(mapMembers.mapId, theirMaps),
            eq(mapMembers.role, 'owner'),
            ne(mapMembers.userId, ownerId),
          ),
        );
      return row?.n ?? 0;
    },

    insertInvite: async (invite) => {
      await db.insert(inviteCodes).values(invite);
    },

    revokeInvites: async (mapId, now) => {
      await db
        .update(inviteCodes)
        .set({ revokedAt: now })
        .where(and(eq(inviteCodes.mapId, mapId), isNull(inviteCodes.revokedAt)));
    },

    liveInvite: async (mapId, now) => {
      const [row] = await db
        .select({ code: inviteCodes.code, expiresAt: inviteCodes.expiresAt })
        .from(inviteCodes)
        .where(
          and(
            eq(inviteCodes.mapId, mapId),
            isNull(inviteCodes.revokedAt),
            gt(inviteCodes.expiresAt, now),
          ),
        );
      return row ?? null;
    },

    findLiveInviteByCode: async (code, now) => {
      const [row] = await db
        .select({ id: inviteCodes.id, mapId: maps.id, mapName: maps.name })
        .from(inviteCodes)
        .innerJoin(maps, eq(maps.id, inviteCodes.mapId))
        .where(
          and(
            eq(inviteCodes.code, code),
            isNull(inviteCodes.revokedAt),
            gt(inviteCodes.expiresAt, now),
            eq(maps.kind, 'multiplayer'),
          ),
        );
      return row ?? null;
    },

    findPendingRequest: async (mapId, userId) => {
      const [row] = await db
        .select({ id: joinRequests.id, createdAt: joinRequests.createdAt })
        .from(joinRequests)
        .where(
          and(
            eq(joinRequests.mapId, mapId),
            eq(joinRequests.userId, userId),
            eq(joinRequests.status, 'pending'),
          ),
        );
      return row ?? null;
    },

    insertJoinRequest: async (request) => {
      const [row] = await db
        .insert(joinRequests)
        .values(request)
        .returning({ id: joinRequests.id, createdAt: joinRequests.createdAt });
      if (!row) throw new Error('insertJoinRequest: insert returned no row');
      return row;
    },

    lockJoinRequest: async (mapId, requestId) => {
      const [row] = await db
        .select({ userId: joinRequests.userId, status: joinRequests.status })
        .from(joinRequests)
        .where(and(eq(joinRequests.id, requestId), eq(joinRequests.mapId, mapId)))
        .for('update');
      return row ?? null;
    },

    decideJoinRequest: async (input) => {
      const decided = await db
        .update(joinRequests)
        .set({ status: input.status, decidedAt: input.now })
        .where(
          and(
            eq(joinRequests.id, input.requestId),
            eq(joinRequests.mapId, input.mapId),
            eq(joinRequests.status, 'pending'),
          ),
        )
        .returning({ id: joinRequests.id });
      return decided.length > 0;
    },

    listPendingRequests: async (mapId) =>
      db
        .select({
          id: joinRequests.id,
          user: { id: users.id, username: users.username },
          createdAt: joinRequests.createdAt,
        })
        .from(joinRequests)
        .innerJoin(users, eq(users.id, joinRequests.userId))
        .where(and(eq(joinRequests.mapId, mapId), eq(joinRequests.status, 'pending')))
        .orderBy(asc(joinRequests.createdAt), asc(joinRequests.id)),

    listMyPendingRequests: async (userId) =>
      db
        .select({
          id: joinRequests.id,
          mapName: maps.name,
          owner: { id: ownerUsers.id, username: ownerUsers.username },
          createdAt: joinRequests.createdAt,
        })
        .from(joinRequests)
        .innerJoin(maps, eq(maps.id, joinRequests.mapId))
        .innerJoin(owners, and(eq(owners.mapId, maps.id), eq(owners.role, 'owner')))
        .innerJoin(ownerUsers, eq(ownerUsers.id, owners.userId))
        .where(and(eq(joinRequests.userId, userId), eq(joinRequests.status, 'pending')))
        .orderBy(asc(joinRequests.createdAt), asc(joinRequests.id)),
  };
}
