// Admin grants and authenticator enrolment (#196, owner decision 2026-10-07).
// Only the host scripts `ops/grant-admin.ts` and `ops/enrol-totp.ts` call
// these; no HTTP route does. Each change and its audit row commit together.
import type { Executor } from '../../db/client.js';
import type { Clock } from '../../lib/time.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { createAdminRepo, type AdminRepo } from './repo.js';
import { matchTotp, newTotpSecret } from './totp.js';

export type GrantResult = 'no_such_user' | 'unchanged' | 'changed';

/** An audit row for something a host script did (no actor: the host). */
const hostAudit = (repo: AdminRepo, action: string, userId: string) =>
  repo.audit({ actorUserId: null, action, targetUserId: userId }, 'done');

/** Records something a host script did to an account outside these functions. */
export async function recordHostAction(
  db: Executor,
  action: string,
  targetUserId: string,
): Promise<void> {
  await hostAudit(createAdminRepo(db), action, targetUserId);
}

/** Makes an account an admin. They still need an authenticator before they can sign in. */
export function grantAdmin(db: Executor, username: string): Promise<GrantResult> {
  return createAdminRepo(db).transaction(async (repo) => {
    const user = await repo.lockAccount(username);
    if (!user) return 'no_such_user';
    if (user.role === 'admin') return 'unchanged';
    await repo.setRole(user.id, 'admin');
    await hostAudit(repo, AUDIT_ACTIONS.granted, user.id);
    return 'changed';
  });
}

/** Takes admin away: the role, the authenticator and every admin session. */
export function revokeAdmin(db: Executor, username: string): Promise<GrantResult> {
  return createAdminRepo(db).transaction(async (repo) => {
    const user = await repo.lockAccount(username);
    if (!user) return 'no_such_user';
    if (user.role !== 'admin') return 'unchanged';
    await repo.setRole(user.id, 'player');
    await repo.deleteAdminSessions(user.id);
    await repo.deleteTotp(user.id);
    await hostAudit(repo, AUDIT_ACTIONS.revoked, user.id);
    return 'changed';
  });
}

/**
 * A new authenticator secret for an admin, waiting for `confirmTotp`. Any
 * old one stops working and their admin sessions end. Null if the account
 * isn't an admin.
 */
export function startTotp(
  db: Executor,
  username: string,
  clock: Clock,
): Promise<{ username: string; secret: string } | null> {
  return createAdminRepo(db).transaction(async (repo) => {
    const user = await repo.lockAccount(username);
    if (user?.role !== 'admin') return null;
    const secret = newTotpSecret();
    await repo.startTotp(user.id, secret, clock());
    await repo.deleteAdminSessions(user.id);
    await hostAudit(repo, AUDIT_ACTIONS.totpStarted, user.id);
    return { username: user.username, secret };
  });
}

export type ConfirmResult = 'not_started' | 'wrong_code' | 'enrolled';

/** Confirms the authenticator with a code it shows; sign-in works from then on. */
export function confirmTotp(
  db: Executor,
  username: string,
  code: string,
  clock: Clock,
): Promise<ConfirmResult> {
  return createAdminRepo(db).transaction(async (repo) => {
    const user = await repo.lockAccount(username);
    if (user?.role !== 'admin') return 'not_started';
    const secret = await repo.pendingTotpSecret(user.id);
    if (secret === null) return 'not_started';
    const at = clock();
    const step = matchTotp(secret, code.replace(/\s+/g, ''), at, null);
    if (step === null) return 'wrong_code';
    // The confirming code is spent, so it can't also sign in.
    await repo.enrolTotp(user.id, at, step);
    await hostAudit(repo, AUDIT_ACTIONS.totpEnrolled, user.id);
    return 'enrolled';
  });
}
