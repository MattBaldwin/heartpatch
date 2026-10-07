import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { recoveryCodes, sessions, users } from '../../db/schema.js';

export interface AccountUser {
  id: string;
  username: string;
}

export interface UserWithPassword extends AccountUser {
  passwordHash: string;
}

export interface NewSession {
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionWithUser {
  sessionId: string;
  expiresAt: Date;
  user: AccountUser;
}

export interface PasswordReset {
  userId: string;
  passwordHash: string;
  newRecoveryCodeHash: string;
  /** The code being redeemed; the reset fails if it was used meanwhile. Omit for operator resets. */
  redeemRecoveryCodeId?: string;
  /** Logs this device in after the reset. */
  session?: NewSession;
  now: Date;
}

export interface AuthRepo {
  /**
   * Creates the user, spends their sign-up code, and stores their recovery
   * code and a session, in one transaction; null if the username is taken.
   */
  createAccount: (input: {
    username: string;
    passwordHash: string;
    birthYear: number;
    timeZone: string;
    recoveryCodeHash: string;
    session: NewSession;
    /**
     * Spends the sign-up code in the same transaction, right after the user
     * row exists (rule 7). Throwing rolls the whole account back. Omitted
     * only where nothing was typed (tests).
     */
    redeem?: (tx: Executor, userId: string) => Promise<unknown>;
  }) => Promise<AccountUser | null>;
  /** Case-insensitive lookup. */
  findUserByUsername: (username: string) => Promise<UserWithPassword | null>;
  findPasswordHash: (userId: string) => Promise<string | null>;
  createSession: (userId: string, session: NewSession) => Promise<void>;
  /** The unexpired session for a token hash, with its user. */
  findSession: (tokenHash: string, now: Date) => Promise<SessionWithUser | null>;
  extendSession: (sessionId: string, expiresAt: Date) => Promise<void>;
  deleteSession: (tokenHash: string) => Promise<void>;
  findActiveRecoveryCode: (userId: string) => Promise<{ id: string; codeHash: string } | null>;
  /**
   * Atomically: retires the active recovery code, sets the password, revokes
   * every session, stores the new code and (optionally) a new session.
   * Returns false, changing nothing, if `redeemRecoveryCodeId` is no longer active.
   */
  resetPassword: (reset: PasswordReset) => Promise<boolean>;
  /**
   * Replaces the active recovery code with a new one (#197), in one
   * transaction. Sessions and the password stay as they are. False, changing
   * nothing, if the password is no longer `passwordHash` (reset meanwhile).
   */
  replaceRecoveryCode: (change: {
    userId: string;
    passwordHash: string;
    codeHash: string;
    now: Date;
  }) => Promise<boolean>;
}

class RollbackSignal extends Error {}

/**
 * Every recovery code rotation locks the account first (tech spec §7, step
 * 4), then `recovery_codes`, so a recover, a new code and a reset by
 * someone else take turns instead of deadlocking. Returns its password hash.
 */
async function lockAccount(tx: Executor, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .for('no key update');
  return row?.passwordHash ?? null;
}

export function createAuthRepo(db: Executor): AuthRepo {
  return {
    createAccount: async (input) => {
      try {
        return await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              username: input.username,
              passwordHash: input.passwordHash,
              birthYear: input.birthYear,
              timeZone: input.timeZone,
            })
            .returning({ id: users.id, username: users.username });
          if (!user) throw new Error('createAccount: insert returned no row');
          await input.redeem?.(tx, user.id);
          await tx
            .insert(recoveryCodes)
            .values({ userId: user.id, codeHash: input.recoveryCodeHash });
          await tx.insert(sessions).values({ userId: user.id, ...input.session });
          return user;
        });
      } catch (err) {
        if (isUniqueViolation(err)) return null;
        throw err;
      }
    },

    findUserByUsername: async (username) => {
      const [user] = await db
        .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
        .limit(1);
      return user ?? null;
    },

    findPasswordHash: async (userId) => {
      const [user] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId));
      return user?.passwordHash ?? null;
    },

    createSession: async (userId, session) => {
      await db.insert(sessions).values({ userId, ...session });
    },

    findSession: async (tokenHash, now) => {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          expiresAt: sessions.expiresAt,
          user: { id: users.id, username: users.username },
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return row ?? null;
    },

    extendSession: async (sessionId, expiresAt) => {
      await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId));
    },

    deleteSession: async (tokenHash) => {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    findActiveRecoveryCode: async (userId) => {
      const [row] = await db
        .select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash })
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
        .limit(1);
      return row ?? null;
    },

    resetPassword: async (reset) => {
      try {
        await db.transaction(async (tx) => {
          await lockAccount(tx, reset.userId);
          // Retire the active code. When redeeming, it must be the one checked,
          // so two concurrent resets with the same code can't both succeed.
          const retired = await tx
            .update(recoveryCodes)
            .set({ usedAt: reset.now })
            .where(and(eq(recoveryCodes.userId, reset.userId), isNull(recoveryCodes.usedAt)))
            .returning({ id: recoveryCodes.id });
          if (
            reset.redeemRecoveryCodeId !== undefined &&
            !retired.some((r) => r.id === reset.redeemRecoveryCodeId)
          ) {
            throw new RollbackSignal();
          }
          await tx
            .update(users)
            .set({ passwordHash: reset.passwordHash })
            .where(eq(users.id, reset.userId));
          await tx.delete(sessions).where(eq(sessions.userId, reset.userId));
          await tx
            .insert(recoveryCodes)
            .values({ userId: reset.userId, codeHash: reset.newRecoveryCodeHash });
          if (reset.session)
            await tx.insert(sessions).values({ userId: reset.userId, ...reset.session });
        });
        return true;
      } catch (err) {
        if (err instanceof RollbackSignal) return false;
        throw err;
      }
    },

    replaceRecoveryCode: async ({ userId, passwordHash, codeHash, now }) =>
      db.transaction(async (tx) => {
        // The password was checked before the lock; a reset since then
        // changed it, and that reset's new code must stay the active one.
        if ((await lockAccount(tx, userId)) !== passwordHash) return false;
        await tx
          .update(recoveryCodes)
          .set({ usedAt: now })
          .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
        await tx.insert(recoveryCodes).values({ userId, codeHash });
        return true;
      }),
  };
}
