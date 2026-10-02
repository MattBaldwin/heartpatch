import type { KeeperConfig, MapRole, PublicTile, PvpMode } from '@heartpatch/shared';
import { and, asc, count, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  inviteCodes,
  joinRequests,
  keepers,
  mapMembers,
  maps,
  tiles,
  users,
} from '../../db/schema.js';
import { keeperColumns } from '../keepers/repo.js';

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

export interface MapSummaryRow {
  id: string;
  name: string;
  role: MapRole;
  owner: UserRef;
  memberCount: number;
  maxPlayers: number;
  pvpMode: PvpMode;
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
  /** Shown to the other members (#42); null until they pick one. */
  keeper: KeeperConfig | null;
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
  snapshot: <T>(fn: (repo: MapsRepo) => Promise<T>) => Promise<T>;

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
  listTiles: (mapId: string) => Promise<PublicTile[]>;
  /** Gives the player every tile of a home slot; returns those tiles. */
  claimHomeTiles: (
    mapId: string,
    homeSlot: number,
    userId: string,
  ) => Promise<{ q: number; r: number }[]>;
  /** Sends all of a player's tiles back to neutral; returns how many. */
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
  /** Home slots held by active members. Run after `lockSeats` for an exact answer. */
  activeHomeSlots: (mapId: string) => Promise<{ count: number; slots: Set<number> }>;
  /** Active members, owner first, then by join time. */
  listMembers: (mapId: string) => Promise<MemberRow[]>;
  owner: (mapId: string) => Promise<UserRef | null>;
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

const owners = alias(mapMembers, 'owners');
const ownerUsers = alias(users, 'owner_users');

/** Active members per map, as a correlated subquery. */
const activeMemberCount = sql<number>`(
  select count(*)::int from ${mapMembers} as m
  where m.map_id = ${maps.id} and m.status = 'active'
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
        return fn(queries(tx));
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

    listTiles: async (mapId) =>
      db
        .select({
          q: tiles.q,
          r: tiles.r,
          terrain: tiles.terrain,
          ownerUserId: tiles.ownerUserId,
          nodeResource: tiles.nodeResource,
          homeSlot: tiles.homeSlot,
        })
        .from(tiles)
        .where(eq(tiles.mapId, mapId))
        .orderBy(asc(tiles.q), asc(tiles.r)),

    claimHomeTiles: async (mapId, homeSlot, userId) =>
      db
        .update(tiles)
        .set({ ownerUserId: userId })
        .where(and(eq(tiles.mapId, mapId), eq(tiles.homeSlot, homeSlot)))
        .returning({ q: tiles.q, r: tiles.r }),

    releaseTiles: async (mapId, userId) => {
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

    activeHomeSlots: async (mapId) => {
      const rows = await db
        .select({ homeSlot: mapMembers.homeSlot })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active')));
      const slots = new Set<number>();
      for (const row of rows) if (row.homeSlot !== null) slots.add(row.homeSlot);
      return { count: rows.length, slots };
    },

    listMembers: async (mapId) =>
      db
        .select({
          user: { id: users.id, username: users.username },
          role: mapMembers.role,
          homeSlot: mapMembers.homeSlot,
          joinedAt: mapMembers.joinedAt,
          // Drizzle makes a left-joined object null when every column is null.
          keeper: keeperColumns,
        })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .leftJoin(keepers, eq(keepers.userId, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active')))
        // 'owner' is the enum's first value, so it sorts first.
        .orderBy(asc(mapMembers.role), asc(mapMembers.joinedAt), asc(users.id)),

    owner: async (mapId) => {
      const [row] = await db
        .select({ id: users.id, username: users.username })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.role, 'owner')));
      return row ?? null;
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
