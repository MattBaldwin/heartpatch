import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { inviteCodes, mapMembers, maps, signupCodes, users } from '../../db/schema.js';

export interface SignupCodeRow {
  id: string;
  label: string;
  createdByUserId: string | null;
  maxUses: number;
  useCount: number;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface InviteRow {
  id: string;
  mapId: string;
  createdByUserId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SignupCodesRepo {
  /** Runs `fn` in one transaction; `tx` builds other modules' repos on it too. */
  transaction: <T>(fn: (repo: SignupCodesRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** Throws a unique violation (see `isUniqueViolation`) if the hash is taken. */
  insert: (code: {
    codeHash: string;
    label: string;
    createdByUserId: string | null;
    maxUses: number;
    expiresAt: Date;
  }) => Promise<SignupCodeRow>;
  findByHash: (codeHash: string) => Promise<SignupCodeRow | null>;
  find: (id: string) => Promise<SignupCodeRow | null>;
  /**
   * Spends one use of a live code, atomically: the row lock makes concurrent
   * sign-ups queue, and each re-checks `use_count` once the one before it
   * commits. Null (nothing spent) if the code isn't live.
   */
  spend: (
    codeHash: string,
    now: Date,
  ) => Promise<{ id: string; createdByUserId: string | null } | null>;
  /** Live codes this player made. Call with their `users` row locked. */
  countLive: (userId: string, now: Date) => Promise<number>;
  /**
   * Codes by one maker, or every code (`createdBy` undefined): live ones and
   * those made since `since`, live first, then newest first.
   */
  list: (
    createdBy: string | undefined,
    now: Date,
    since: Date,
    limit: number,
  ) => Promise<SignupCodeRow[]>;
  /** Who signed up with each code, oldest first. */
  usedBy: (codeIds: readonly string[]) => Promise<Map<string, string[]>>;
  /** Usernames by id. */
  usernames: (userIds: readonly string[]) => Promise<Map<string, string>>;
  /** Turns a code off; false if it was already off (or isn't `createdBy`'s, when given). */
  revoke: (id: string, createdBy: string | undefined, now: Date) => Promise<boolean>;
  /** Whether the player owns a multiplayer patch they're still active in. */
  ownsPatch: (userId: string) => Promise<boolean>;
  /** A patch invite by its normalized code, live or not (for the right message). */
  findInvite: (code: string) => Promise<InviteRow | null>;
  /** Sets who brought a new account in. */
  setAttribution: (
    userId: string,
    attribution: { signupCodeId: string | null; invitedBy: string | null },
  ) => Promise<void>;
}

const columns = {
  id: signupCodes.id,
  label: signupCodes.label,
  createdByUserId: signupCodes.createdByUserId,
  maxUses: signupCodes.maxUses,
  useCount: signupCodes.useCount,
  createdAt: signupCodes.createdAt,
  expiresAt: signupCodes.expiresAt,
  revokedAt: signupCodes.revokedAt,
};

/** Not turned off, not too old, not used up. */
const live = (now: Date) =>
  and(
    isNull(signupCodes.revokedAt),
    gt(signupCodes.expiresAt, now),
    lt(signupCodes.useCount, signupCodes.maxUses),
  );

export function createSignupCodesRepo(db: Executor): SignupCodesRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createSignupCodesRepo(tx), tx)),

    insert: async (code) => {
      const [row] = await db.insert(signupCodes).values(code).returning(columns);
      if (!row) throw new Error('signup code insert returned no row');
      return row;
    },

    findByHash: async (codeHash) => {
      const [row] = await db
        .select(columns)
        .from(signupCodes)
        .where(eq(signupCodes.codeHash, codeHash))
        .limit(1);
      return row ?? null;
    },

    find: async (id) => {
      const [row] = await db.select(columns).from(signupCodes).where(eq(signupCodes.id, id));
      return row ?? null;
    },

    spend: async (codeHash, now) => {
      const [row] = await db
        .update(signupCodes)
        .set({ useCount: sql`${signupCodes.useCount} + 1` })
        .where(and(eq(signupCodes.codeHash, codeHash), live(now)))
        .returning({ id: signupCodes.id, createdByUserId: signupCodes.createdByUserId });
      return row ?? null;
    },

    countLive: async (userId, now) => {
      const [row] = await db
        .select({ n: count() })
        .from(signupCodes)
        .where(and(eq(signupCodes.createdByUserId, userId), live(now)));
      return row?.n ?? 0;
    },

    list: async (createdBy, now, since, limit) => {
      const byMaker =
        createdBy === undefined ? undefined : eq(signupCodes.createdByUserId, createdBy);
      return db
        .select(columns)
        .from(signupCodes)
        .where(and(byMaker, or(live(now), gt(signupCodes.createdAt, since))))
        .orderBy(desc(sql`(${live(now)})`), desc(signupCodes.createdAt), desc(signupCodes.id))
        .limit(limit);
    },

    usedBy: async (codeIds) => {
      const byCode = new Map<string, string[]>();
      if (codeIds.length === 0) return byCode;
      const rows = await db
        .select({ codeId: users.signupCodeId, username: users.username })
        .from(users)
        .where(inArray(users.signupCodeId, [...codeIds]))
        .orderBy(asc(users.createdAt), asc(users.id));
      for (const { codeId, username } of rows) {
        if (codeId === null) continue;
        byCode.set(codeId, [...(byCode.get(codeId) ?? []), username]);
      }
      return byCode;
    },

    usernames: async (userIds) => {
      if (userIds.length === 0) return new Map();
      const rows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, [...userIds]));
      return new Map(rows.map((r) => [r.id, r.username]));
    },

    revoke: async (id, createdBy, now) => {
      const rows = await db
        .update(signupCodes)
        .set({ revokedAt: now })
        .where(
          and(
            eq(signupCodes.id, id),
            isNull(signupCodes.revokedAt),
            createdBy === undefined ? undefined : eq(signupCodes.createdByUserId, createdBy),
          ),
        )
        .returning({ id: signupCodes.id });
      return rows.length > 0;
    },

    ownsPatch: async (userId) => {
      const [row] = await db
        .select({ id: maps.id })
        .from(mapMembers)
        .innerJoin(maps, eq(maps.id, mapMembers.mapId))
        .where(
          and(
            eq(mapMembers.userId, userId),
            eq(mapMembers.role, 'owner'),
            eq(mapMembers.status, 'active'),
            eq(maps.kind, 'multiplayer'),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    findInvite: async (code) => {
      const [row] = await db
        .select({
          id: inviteCodes.id,
          mapId: inviteCodes.mapId,
          createdByUserId: inviteCodes.createdByUserId,
          expiresAt: inviteCodes.expiresAt,
          revokedAt: inviteCodes.revokedAt,
        })
        .from(inviteCodes)
        .innerJoin(maps, eq(maps.id, inviteCodes.mapId))
        .where(and(eq(inviteCodes.code, code), eq(maps.kind, 'multiplayer')))
        .limit(1);
      return row ?? null;
    },

    setAttribution: async (userId, attribution) => {
      await db.update(users).set(attribution).where(eq(users.id, userId));
    },
  };
}
