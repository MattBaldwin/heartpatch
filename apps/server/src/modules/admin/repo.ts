import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type AnyColumn,
  type SQL,
  getTableName,
} from 'drizzle-orm';

import { alias } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor } from '../../db/client.js';
import {
  adminAudit,
  adminSessions,
  adminTotp,
  gameEvents,
  hollowEvents,
  joinRequests,
  mapMembers,
  maps,
  recoveryCodes,
  sessions,
  signupCodes,
  users,
} from '../../db/schema.js';

// The admin console's reads and its own writes (#196). Commands that already
// exist elsewhere (resets, join requests, invites, family codes) go through
// their own modules; this repo only adds what has no other home.

export type UserRole = 'player' | 'admin';

export interface AdminAccountRow {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  totp: { secret: string; enrolledAt: Date | null; lastStep: number | null } | null;
}

export interface AdminSessionRow {
  sessionId: string;
  user: { id: string; username: string };
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  targetUserId?: string | null;
  targetMapId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

export interface PatchRow {
  id: string;
  name: string;
  kind: 'multiplayer' | 'tutorial';
  timeZone: string;
  owner: string | null;
  members: number;
  maxPlayers: number;
  createdAt: Date;
  lastActivityAt: Date | null;
  pvpMode: 'on' | 'gentle' | 'off';
  pendingRequests: number;
}

export interface PlayerRow {
  id: string;
  username: string;
  role: UserRole;
  createdAt: Date;
  lastSignInAt: Date | null;
  activeSessions: number;
  hasRecoveryCode: boolean;
  patches: number;
}

export interface PlayerPatchRow {
  mapId: string;
  name: string;
  status: 'owner' | 'member' | 'requested' | 'left';
  since: Date;
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  actor: string | null;
  action: string;
  targetUser: string | null;
  targetMap: string | null;
  detail: unknown;
  outcome: 'pending' | 'done' | 'failed';
}

export interface Page<T> {
  rows: T[];
  total: number;
}

export interface PatchMemberRow {
  userId: string;
  username: string;
  role: 'owner' | 'member';
  joinedAt: Date;
  lastActiveAt: Date | null;
}

export interface PendingRequestRow {
  id: string;
  userId: string;
  username: string;
  createdAt: Date;
}

export interface LookupRow {
  userId: string;
  username: string;
  mapName: string;
  status: PlayerPatchRow['status'];
  since: Date;
}

export interface AdminRepo {
  transaction: <T>(fn: (repo: AdminRepo) => Promise<T>) => Promise<T>;
  // Host scripts
  lockAccount: (
    username: string,
  ) => Promise<{ id: string; username: string; role: UserRole } | null>;
  setRole: (userId: string, role: UserRole) => Promise<void>;
  deleteAdminSessions: (userId: string) => Promise<void>;
  deleteTotp: (userId: string) => Promise<void>;
  startTotp: (userId: string, secret: string, at: Date) => Promise<void>;
  pendingTotpSecret: (userId: string) => Promise<string | null>;
  enrolTotp: (userId: string, at: Date, step: number) => Promise<void>;
  // Sign-in and sessions
  findAccount: (username: string) => Promise<AdminAccountRow | null>;
  useTotpStep: (userId: string, step: number) => Promise<boolean>;
  createSession: (session: {
    userId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  }) => Promise<void>;
  touchSession: (tokenHash: string, now: Date, idleSince: Date) => Promise<AdminSessionRow | null>;
  deleteSession: (tokenHash: string) => Promise<void>;
  // Audit
  audit: (input: AuditInput, outcome?: 'pending' | 'done' | 'failed') => Promise<string>;
  finishAudit: (id: string, outcome: 'done' | 'failed') => Promise<void>;
  listAudit: (q: string | undefined, limit: number, offset: number) => Promise<Page<AuditRow>>;
  // Patches
  listPatches: (
    filter: { q: string | undefined; tutorial: boolean },
    limit: number,
    offset: number,
  ) => Promise<Page<PatchRow>>;
  findPatch: (mapId: string) => Promise<PatchRow | null>;
  patchMembers: (mapId: string) => Promise<PatchMemberRow[]>;
  pendingRequests: (mapId: string) => Promise<PendingRequestRow[]>;
  recentNights: (mapId: string, limit: number) => Promise<{ night: string; outcomes: unknown }[]>;
  usernames: (ids: readonly string[]) => Promise<Map<string, string>>;
  // Players
  listPlayers: (
    q: string | undefined,
    now: Date,
    limit: number,
    offset: number,
  ) => Promise<Page<PlayerRow>>;
  findPlayer: (
    userId: string,
    now: Date,
  ) => Promise<(PlayerRow & { signupCodeLabel: string | null; invitedBy: string | null }) | null>;
  playerPatches: (userId: string) => Promise<PlayerPatchRow[]>;
  findUsername: (userId: string) => Promise<string | null>;
  deleteSessions: (userId: string) => Promise<number>;
  lookup: (patch: string, from: Date, to: Date, limit: number) => Promise<LookupRow[]>;
  // Family codes
  extendSignupCode: (codeId: string, ms: number, now: Date) => Promise<boolean>;
}

/**
 * A column written `"table"."column"`. Drizzle leaves the table off when a
 * query reads one table, which would bind a correlated subquery's outer
 * column to its own table (as `squishyAtWork` in jobs does).
 */
const col = (column: AnyColumn) =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

/** `%text%` for ILIKE, with the user's own wildcards taken literally. */
function contains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function createAdminRepo(db: Executor): AdminRepo {
  const ownerUser = alias(users, 'owner_user');

  /** Active members per map. */
  const memberCount = sql<number>`(
    select count(*)::int from ${mapMembers}
    where ${col(mapMembers.mapId)} = ${col(maps.id)} and ${col(mapMembers.status)} = 'active'
  )`;
  const pendingCount = sql<number>`(
    select count(*)::int from ${joinRequests}
    where ${col(joinRequests.mapId)} = ${col(maps.id)} and ${col(joinRequests.status)} = 'pending'
  )`;
  const lastActivity = sql<Date | null>`(
    select max(${col(gameEvents.createdAt)}) from ${gameEvents} where ${col(gameEvents.mapId)} = ${col(maps.id)}
  )`.mapWith(maps.createdAt);

  const patchColumns = {
    id: maps.id,
    name: maps.name,
    kind: maps.kind,
    timeZone: maps.timeZone,
    owner: ownerUser.username,
    members: memberCount,
    maxPlayers: maps.maxPlayers,
    createdAt: maps.createdAt,
    lastActivityAt: lastActivity,
    pvpMode: maps.pvpMode,
    pendingRequests: pendingCount,
  };
  const ownerJoin = and(eq(mapMembers.mapId, maps.id), eq(mapMembers.role, 'owner'));

  const liveSessionCount = (now: Date) => sql<number>`(
    select count(*)::int from ${sessions}
    where ${col(sessions.userId)} = ${col(users.id)} and ${col(sessions.expiresAt)} > ${now.toISOString()}::timestamptz
  )`;
  const lastSignIn = (now: Date) =>
    sql<Date | null>`(
    select max(${col(sessions.createdAt)}) from ${sessions}
    where ${col(sessions.userId)} = ${col(users.id)} and ${col(sessions.expiresAt)} > ${now.toISOString()}::timestamptz
  )`.mapWith(users.createdAt);
  const hasRecovery = sql<boolean>`exists (
    select 1 from ${recoveryCodes}
    where ${col(recoveryCodes.userId)} = ${col(users.id)} and ${col(recoveryCodes.usedAt)} is null
  )`;
  const patchCount = sql<number>`(
    select count(*)::int from ${mapMembers} inner join ${maps} on ${col(maps.id)} = ${col(mapMembers.mapId)}
    where ${col(mapMembers.userId)} = ${col(users.id)} and ${col(mapMembers.status)} = 'active'
      and ${col(maps.kind)} = 'multiplayer'
  )`;
  const playerColumns = (now: Date) => ({
    id: users.id,
    username: users.username,
    role: users.role,
    createdAt: users.createdAt,
    lastSignInAt: lastSignIn(now),
    activeSessions: liveSessionCount(now),
    hasRecoveryCode: hasRecovery,
    patches: patchCount,
  });

  return {
    /** Runs `fn` in one transaction, with this repo on it. */
    transaction: (fn) => withTransaction(db, (tx) => fn(createAdminRepo(tx))),

    // --- Host scripts (grants and authenticator setup) ---------------------

    /** Locks an account by name (tech spec §7, step 4) and reads its role. */
    lockAccount: async (
      username: string,
    ): Promise<{ id: string; username: string; role: UserRole } | null> => {
      const [row] = await db
        .select({ id: users.id, username: users.username, role: users.role })
        .from(users)
        .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
        .for('no key update');
      return row ?? null;
    },

    setRole: async (userId: string, role: UserRole): Promise<void> => {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    /** Ends every admin console session of an account. */
    deleteAdminSessions: async (userId: string): Promise<void> => {
      await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
    },

    deleteTotp: async (userId: string): Promise<void> => {
      await db.delete(adminTotp).where(eq(adminTotp.userId, userId));
    },

    /** A new, unconfirmed authenticator secret, replacing any old one. */
    startTotp: async (userId: string, secret: string, at: Date): Promise<void> => {
      await db
        .insert(adminTotp)
        .values({ userId, secret, createdAt: at })
        .onConflictDoUpdate({
          target: adminTotp.userId,
          set: { secret, createdAt: at, enrolledAt: null, lastStep: null },
        });
    },

    /** The secret waiting to be confirmed, if any. */
    pendingTotpSecret: async (userId: string): Promise<string | null> => {
      const [row] = await db
        .select({ secret: adminTotp.secret })
        .from(adminTotp)
        .where(and(eq(adminTotp.userId, userId), isNull(adminTotp.enrolledAt)));
      return row?.secret ?? null;
    },

    /** Confirms the authenticator; the confirming code's step is spent. */
    enrolTotp: async (userId: string, at: Date, step: number): Promise<void> => {
      await db
        .update(adminTotp)
        .set({ enrolledAt: at, lastStep: step })
        .where(eq(adminTotp.userId, userId));
    },

    // --- Sign-in and sessions ---------------------------------------------

    /** Case-insensitive, like player sign-in. */
    findAccount: async (username: string): Promise<AdminAccountRow | null> => {
      const [row] = await db
        .select({
          id: users.id,
          username: users.username,
          passwordHash: users.passwordHash,
          role: users.role,
          secret: adminTotp.secret,
          enrolledAt: adminTotp.enrolledAt,
          lastStep: adminTotp.lastStep,
        })
        .from(users)
        .leftJoin(adminTotp, eq(adminTotp.userId, users.id))
        .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        username: row.username,
        passwordHash: row.passwordHash,
        role: row.role,
        totp:
          row.secret === null
            ? null
            : { secret: row.secret, enrolledAt: row.enrolledAt, lastStep: row.lastStep },
      };
    },

    /**
     * Records `step` as used, only if it is newer than the last one, so two
     * sign-ins with the same code can't both pass. False if one already did.
     */
    useTotpStep: async (userId: string, step: number): Promise<boolean> => {
      const rows = await db
        .update(adminTotp)
        .set({ lastStep: step })
        .where(
          and(
            eq(adminTotp.userId, userId),
            sql`${adminTotp.enrolledAt} is not null`,
            or(isNull(adminTotp.lastStep), sql`${adminTotp.lastStep} < ${step}`),
          ),
        )
        .returning({ userId: adminTotp.userId });
      return rows.length > 0;
    },

    createSession: async (session: {
      userId: string;
      tokenHash: string;
      now: Date;
      expiresAt: Date;
    }): Promise<void> => {
      await db.insert(adminSessions).values({
        userId: session.userId,
        tokenHash: session.tokenHash,
        createdAt: session.now,
        lastSeenAt: session.now,
        expiresAt: session.expiresAt,
      });
    },

    /**
     * The live session for a token, re-checked on every request: still an
     * admin, still enrolled, not idle past `idleSince`, not past its expiry.
     * Touches `last_seen_at` in the same statement.
     */
    touchSession: async (
      tokenHash: string,
      now: Date,
      idleSince: Date,
    ): Promise<AdminSessionRow | null> => {
      const [row] = await db
        .update(adminSessions)
        .set({ lastSeenAt: now })
        .from(users)
        .where(
          and(
            eq(adminSessions.tokenHash, tokenHash),
            eq(users.id, adminSessions.userId),
            eq(users.role, 'admin'),
            gt(adminSessions.lastSeenAt, idleSince),
            gt(adminSessions.expiresAt, now),
            sql`exists (select 1 from ${adminTotp} where ${col(adminTotp.userId)} = ${col(users.id)}
              and ${col(adminTotp.enrolledAt)} is not null)`,
          ),
        )
        .returning({
          sessionId: adminSessions.id,
          userId: users.id,
          username: users.username,
          lastSeenAt: adminSessions.lastSeenAt,
          expiresAt: adminSessions.expiresAt,
        });
      if (!row) return null;
      return {
        sessionId: row.sessionId,
        user: { id: row.userId, username: row.username },
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
      };
    },

    deleteSession: async (tokenHash: string): Promise<void> => {
      await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
    },

    // --- Audit -------------------------------------------------------------

    /** An audit row (`pending` until `finishAudit`); returns its id. */
    audit: async (
      input: AuditInput,
      outcome: 'pending' | 'done' | 'failed' = 'pending',
    ): Promise<string> => {
      const [row] = await db
        .insert(adminAudit)
        .values({
          actorUserId: input.actorUserId,
          action: input.action,
          targetUserId: input.targetUserId ?? null,
          targetMapId: input.targetMapId ?? null,
          detail: input.detail ?? {},
          ip: input.ip ?? null,
          outcome,
        })
        .returning({ id: adminAudit.id });
      if (!row) throw new Error('audit: insert returned no row');
      return row.id;
    },

    finishAudit: async (id: string, outcome: 'done' | 'failed'): Promise<void> => {
      await db.update(adminAudit).set({ outcome }).where(eq(adminAudit.id, id));
    },

    listAudit: async (
      q: string | undefined,
      limit: number,
      offset: number,
    ): Promise<Page<AuditRow>> => {
      const actor = alias(users, 'actor');
      const target = alias(users, 'target');
      const where = q
        ? or(
            ilike(adminAudit.action, contains(q)),
            ilike(actor.username, contains(q)),
            ilike(target.username, contains(q)),
            ilike(maps.name, contains(q)),
          )
        : undefined;
      const base = db
        .select({
          id: adminAudit.id,
          createdAt: adminAudit.createdAt,
          actor: actor.username,
          action: adminAudit.action,
          targetUser: target.username,
          targetMap: maps.name,
          detail: adminAudit.detail,
          outcome: adminAudit.outcome,
        })
        .from(adminAudit)
        .leftJoin(actor, eq(actor.id, adminAudit.actorUserId))
        .leftJoin(target, eq(target.id, adminAudit.targetUserId))
        .leftJoin(maps, eq(maps.id, adminAudit.targetMapId))
        .where(where);
      const [rows, [total]] = await Promise.all([
        base.orderBy(desc(adminAudit.createdAt), desc(adminAudit.id)).limit(limit).offset(offset),
        db
          .select({ n: count() })
          .from(adminAudit)
          .leftJoin(actor, eq(actor.id, adminAudit.actorUserId))
          .leftJoin(target, eq(target.id, adminAudit.targetUserId))
          .leftJoin(maps, eq(maps.id, adminAudit.targetMapId))
          .where(where),
      ]);
      return { rows, total: total?.n ?? 0 };
    },

    // --- Patches -----------------------------------------------------------

    listPatches: async (
      filter: { q: string | undefined; tutorial: boolean },
      limit: number,
      offset: number,
    ): Promise<Page<PatchRow>> => {
      const conditions: SQL[] = [];
      if (!filter.tutorial) conditions.push(eq(maps.kind, 'multiplayer'));
      if (filter.q) {
        const byName = or(
          ilike(maps.name, contains(filter.q)),
          ilike(ownerUser.username, contains(filter.q)),
        );
        if (byName) conditions.push(byName);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select(patchColumns)
          .from(maps)
          .leftJoin(mapMembers, ownerJoin)
          .leftJoin(ownerUser, eq(ownerUser.id, mapMembers.userId))
          .where(where)
          .orderBy(desc(maps.createdAt), asc(maps.id))
          .limit(limit)
          .offset(offset),
        db
          .select({ n: count() })
          .from(maps)
          .leftJoin(mapMembers, ownerJoin)
          .leftJoin(ownerUser, eq(ownerUser.id, mapMembers.userId))
          .where(where),
      ]);
      return { rows, total: total?.n ?? 0 };
    },

    findPatch: async (mapId: string): Promise<PatchRow | null> => {
      const [row] = await db
        .select(patchColumns)
        .from(maps)
        .leftJoin(mapMembers, ownerJoin)
        .leftJoin(ownerUser, eq(ownerUser.id, mapMembers.userId))
        .where(eq(maps.id, mapId))
        .limit(1);
      return row ?? null;
    },

    /** Active members, owner first, with their latest game event on this map. */
    patchMembers: async (mapId: string) =>
      db
        .select({
          userId: users.id,
          username: users.username,
          role: mapMembers.role,
          joinedAt: mapMembers.joinedAt,
          lastActiveAt: sql<Date | null>`(
            select max(${col(gameEvents.createdAt)}) from ${gameEvents}
            where ${col(gameEvents.mapId)} = ${col(mapMembers.mapId)}
              and ${col(gameEvents.actorUserId)} = ${col(mapMembers.userId)}
          )`.mapWith(mapMembers.joinedAt),
        })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.status, 'active')))
        .orderBy(desc(sql`${mapMembers.role} = 'owner'`), asc(mapMembers.joinedAt)),

    pendingRequests: async (mapId: string) =>
      db
        .select({
          id: joinRequests.id,
          userId: users.id,
          username: users.username,
          createdAt: joinRequests.createdAt,
        })
        .from(joinRequests)
        .innerJoin(users, eq(users.id, joinRequests.userId))
        .where(and(eq(joinRequests.mapId, mapId), eq(joinRequests.status, 'pending')))
        .orderBy(asc(joinRequests.createdAt)),

    recentNights: async (mapId: string, limit: number) =>
      db
        .select({ night: hollowEvents.night, outcomes: hollowEvents.outcomes })
        .from(hollowEvents)
        .where(eq(hollowEvents.mapId, mapId))
        .orderBy(desc(hollowEvents.night))
        .limit(limit),

    usernames: async (ids: readonly string[]): Promise<Map<string, string>> => {
      if (ids.length === 0) return new Map();
      const rows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, [...ids]));
      return new Map(rows.map((r) => [r.id, r.username]));
    },

    // --- Players -----------------------------------------------------------

    listPlayers: async (
      q: string | undefined,
      now: Date,
      limit: number,
      offset: number,
    ): Promise<Page<PlayerRow>> => {
      const where = q ? ilike(users.username, contains(q)) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select(playerColumns(now))
          .from(users)
          .where(where)
          .orderBy(asc(sql`lower(${users.username})`))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(users).where(where),
      ]);
      return { rows, total: total?.n ?? 0 };
    },

    findPlayer: async (userId: string, now: Date) => {
      const inviter = alias(users, 'inviter');
      const [row] = await db
        .select({
          ...playerColumns(now),
          signupCodeLabel: signupCodes.label,
          invitedBy: inviter.username,
        })
        .from(users)
        .leftJoin(signupCodes, eq(signupCodes.id, users.signupCodeId))
        .leftJoin(inviter, eq(inviter.id, users.invitedBy))
        .where(eq(users.id, userId))
        .limit(1);
      return row ?? null;
    },

    /** Patches they're in, left, or asked to join; tutorial runs aren't listed. */
    playerPatches: async (userId: string): Promise<PlayerPatchRow[]> => {
      const [memberships, requests] = await Promise.all([
        db
          .select({
            mapId: maps.id,
            name: maps.name,
            role: mapMembers.role,
            status: mapMembers.status,
            since: mapMembers.joinedAt,
          })
          .from(mapMembers)
          .innerJoin(maps, eq(maps.id, mapMembers.mapId))
          .where(and(eq(mapMembers.userId, userId), eq(maps.kind, 'multiplayer')))
          .orderBy(asc(mapMembers.joinedAt)),
        db
          .select({ mapId: maps.id, name: maps.name, since: joinRequests.createdAt })
          .from(joinRequests)
          .innerJoin(maps, eq(maps.id, joinRequests.mapId))
          .where(and(eq(joinRequests.userId, userId), eq(joinRequests.status, 'pending')))
          .orderBy(asc(joinRequests.createdAt)),
      ]);
      return [
        ...memberships.map((m) => ({
          mapId: m.mapId,
          name: m.name,
          status: m.status === 'removed' ? ('left' as const) : m.role,
          since: m.since,
        })),
        ...requests.map((r) => ({ ...r, status: 'requested' as const })),
      ];
    },

    findUsername: async (userId: string): Promise<string | null> => {
      const [row] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId));
      return row?.username ?? null;
    },

    /** Logs a player out on every device. Returns how many sessions ended. */
    deleteSessions: async (userId: string): Promise<number> => {
      const rows = await db
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      return rows.length;
    },

    // --- Lookup ------------------------------------------------------------

    /**
     * "Forgot my username": players who joined, or asked to join, a patch
     * whose name contains `patch`, between `from` and `to` (instants).
     */
    lookup: async (
      patch: string,
      from: Date,
      to: Date,
      limit: number,
    ): Promise<
      {
        userId: string;
        username: string;
        mapName: string;
        status: PlayerPatchRow['status'];
        since: Date;
      }[]
    > => {
      const [members, requests] = await Promise.all([
        db
          .select({
            userId: users.id,
            username: users.username,
            mapName: maps.name,
            role: mapMembers.role,
            memberStatus: mapMembers.status,
            since: mapMembers.joinedAt,
          })
          .from(mapMembers)
          .innerJoin(maps, eq(maps.id, mapMembers.mapId))
          .innerJoin(users, eq(users.id, mapMembers.userId))
          .where(
            and(
              eq(maps.kind, 'multiplayer'),
              ilike(maps.name, contains(patch)),
              gte(mapMembers.joinedAt, from),
              lt(mapMembers.joinedAt, to),
            ),
          )
          .orderBy(asc(mapMembers.joinedAt))
          .limit(limit),
        db
          .select({
            userId: users.id,
            username: users.username,
            mapName: maps.name,
            since: joinRequests.createdAt,
          })
          .from(joinRequests)
          .innerJoin(maps, eq(maps.id, joinRequests.mapId))
          .innerJoin(users, eq(users.id, joinRequests.userId))
          .where(
            and(
              eq(joinRequests.status, 'pending'),
              eq(maps.kind, 'multiplayer'),
              ilike(maps.name, contains(patch)),
              gte(joinRequests.createdAt, from),
              lt(joinRequests.createdAt, to),
            ),
          )
          .orderBy(asc(joinRequests.createdAt))
          .limit(limit),
      ]);
      return [
        ...members.map((m) => ({
          userId: m.userId,
          username: m.username,
          mapName: m.mapName,
          status: m.memberStatus === 'removed' ? ('left' as const) : m.role,
          since: m.since,
        })),
        ...requests.map((r) => ({ ...r, status: 'requested' as const })),
      ]
        .sort((a, b) => a.since.getTime() - b.since.getTime())
        .slice(0, limit);
    },

    // --- Family codes --------------------------------------------------------

    /**
     * Moves a live code's end `ms` later (from now if it already ended). False
     * if there's no such code or it was turned off.
     */
    extendSignupCode: async (codeId: string, ms: number, now: Date): Promise<boolean> => {
      const rows = await db
        .update(signupCodes)
        .set({
          expiresAt: sql`greatest(${signupCodes.expiresAt}, ${now.toISOString()}::timestamptz) + make_interval(secs => ${ms / 1000})`,
        })
        .where(and(eq(signupCodes.id, codeId), isNull(signupCodes.revokedAt)))
        .returning({ id: signupCodes.id });
      return rows.length > 0;
    },
  };
}
