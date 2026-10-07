import {
  formatRecoveryCode,
  type LoginRequest,
  type PublicUser,
  type RecoverRequest,
  type SignupRequest,
} from '@heartpatch/shared';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import { canonicalTimeZone } from '../../lib/time.js';
import { SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from './limits.js';
import type { SignupPasses } from '../signup-codes/service.js';
import type { AuthRepo, NewSession } from './repo.js';
import {
  hashSecret,
  hashSessionToken,
  newRecoveryCode,
  newSessionToken,
  newResetCredentials,
  verifyAgainstDummy,
  verifySecret,
} from './secrets.js';

/** A logged-in device: the raw token goes in the `hp_session` cookie. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  session: IssuedSession;
}

export interface AuthResultWithCode extends AuthResult {
  /** Shown once (ABCD-EFGH-JKMN); only its hash is stored. */
  recoveryCode: string;
}

export interface AuthService {
  signup: (input: SignupRequest) => Promise<AuthResultWithCode>;
  login: (input: LoginRequest) => Promise<AuthResult>;
  /** Ends this device's session. A missing or unknown token is fine. */
  logout: (token: string | undefined) => Promise<void>;
  /** Sets a new password with the recovery code, revokes every session and logs this device in. */
  recover: (input: RecoverRequest) => Promise<AuthResultWithCode>;
  /** The player behind a session token, renewing the rolling expiry when due. */
  authenticate: (token: string | undefined) => Promise<{
    user: PublicUser;
    /** Set when the expiry moved; the cookie should be re-sent with it. */
    renewed: IssuedSession | null;
  } | null>;
  /**
   * Operator reset (tech spec §9): a temporary password and a fresh recovery
   * code, and every session revoked. Null if there's no such user.
   */
  operatorReset: (
    username: string,
  ) => Promise<{ user: PublicUser; temporaryPassword: string; recoveryCode: string } | null>;
}

export interface AuthServiceOptions {
  repo: AuthRepo;
  /**
   * Checks and spends the code typed on the sign-up screen (#195): a family
   * code, a patch invite or `HP_SIGNUP_CODE`. Omit it to close signups.
   */
  passes?: SignupPasses;
  now?: () => Date;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  signupsClosed: 'New accounts are closed right now. Ask a grown-up for help!',
  usernameTaken: 'Someone already picked that name. Try another one!',
  birthYear: 'Pick the year you were born.',
  timeZone: "Hmm, we couldn't read your clock. Please try again!",
  wrongLogin: "That name and password don't match. Try again!",
  wrongRecoveryCode: "That recovery code doesn't match. Check it and try again!",
} as const;

export function createAuthService(options: AuthServiceOptions): AuthService {
  const { repo, passes } = options;
  const now = options.now ?? (() => new Date());

  const issueSession = (): { issued: IssuedSession; stored: NewSession } => {
    const { token, tokenHash } = newSessionToken();
    const expiresAt = new Date(now().getTime() + SESSION_TTL_MS);
    return { issued: { token, expiresAt }, stored: { tokenHash, expiresAt } };
  };

  return {
    signup: async (input) => {
      // First, so nothing else is revealed without a working code (decision D).
      if (!passes) throw new AppError('FORBIDDEN', MESSAGES.signupsClosed);
      const pass = await passes.check(input.signupCode);
      assertAllowedText(input.username, 'name');
      if (input.birthYear > now().getUTCFullYear()) {
        throw new AppError('VALIDATION_FAILED', MESSAGES.birthYear);
      }
      const timeZone = canonicalTimeZone(input.timeZone);
      if (timeZone === null) throw new AppError('VALIDATION_FAILED', MESSAGES.timeZone);

      const recoveryCode = newRecoveryCode();
      const [passwordHash, recoveryCodeHash] = await Promise.all([
        hashSecret(input.password),
        hashSecret(recoveryCode),
      ]);
      const session = issueSession();
      const user = await repo.createAccount({
        username: input.username,
        passwordHash,
        birthYear: input.birthYear,
        timeZone,
        recoveryCodeHash,
        session: session.stored,
        redeem: (tx, userId) => passes.redeem(tx, pass, userId),
      });
      if (!user) throw new AppError('CONFLICT', MESSAGES.usernameTaken);
      return { user, session: session.issued, recoveryCode: formatRecoveryCode(recoveryCode) };
    },

    login: async (input) => {
      const found = await repo.findUserByUsername(input.username);
      const ok = found
        ? await verifySecret(found.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
      if (!found || !ok) throw new AppError('UNAUTHENTICATED', MESSAGES.wrongLogin);
      const session = issueSession();
      await repo.createSession(found.id, session.stored);
      return { user: { id: found.id, username: found.username }, session: session.issued };
    },

    logout: async (token) => {
      if (token) await repo.deleteSession(hashSessionToken(token));
    },

    recover: async (input) => {
      const found = await repo.findUserByUsername(input.username);
      const code = found ? await repo.findActiveRecoveryCode(found.id) : null;
      const ok =
        found && code
          ? await verifySecret(code.codeHash, input.recoveryCode)
          : await verifyAgainstDummy(input.recoveryCode);
      if (!found || !code || !ok) {
        throw new AppError('UNAUTHENTICATED', MESSAGES.wrongRecoveryCode);
      }

      const recoveryCode = newRecoveryCode();
      const [passwordHash, newRecoveryCodeHash] = await Promise.all([
        hashSecret(input.newPassword),
        hashSecret(recoveryCode),
      ]);
      const session = issueSession();
      const reset = await repo.resetPassword({
        userId: found.id,
        passwordHash,
        newRecoveryCodeHash,
        redeemRecoveryCodeId: code.id,
        session: session.stored,
        now: now(),
      });
      // Someone used this code a moment ago (a double tap, or another device).
      if (!reset) throw new AppError('UNAUTHENTICATED', MESSAGES.wrongRecoveryCode);
      return {
        user: { id: found.id, username: found.username },
        session: session.issued,
        recoveryCode: formatRecoveryCode(recoveryCode),
      };
    },

    authenticate: async (token) => {
      if (!token) return null;
      const at = now();
      const found = await repo.findSession(hashSessionToken(token), at);
      if (!found) return null;
      const renewDue =
        found.expiresAt.getTime() - at.getTime() < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS;
      if (!renewDue) return { user: found.user, renewed: null };
      const expiresAt = new Date(at.getTime() + SESSION_TTL_MS);
      await repo.extendSession(found.sessionId, expiresAt);
      return { user: found.user, renewed: { token, expiresAt } };
    },

    operatorReset: async (username) => {
      const found = await repo.findUserByUsername(username);
      if (!found) return null;
      const credentials = await newResetCredentials();
      await repo.resetPassword({
        userId: found.id,
        passwordHash: credentials.passwordHash,
        newRecoveryCodeHash: credentials.newRecoveryCodeHash,
        now: now(),
      });
      return {
        user: { id: found.id, username: found.username },
        temporaryPassword: credentials.temporaryPassword,
        recoveryCode: credentials.recoveryCode,
      };
    },
  };
}
