import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  formatRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
} from '@heartpatch/shared';
import argon2 from 'argon2';

// Argon2id with the library defaults (64 MiB, 3 passes, 4 lanes), above the
// tech spec §9 floor of 19 MiB / 2 passes. Used for passwords and recovery codes.
const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

export function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, ARGON2_OPTIONS);
}

/** False for a wrong secret or a stored value that isn't an Argon2 hash (e.g. seed users). */
export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real check when there's no user or code to check,
 * so response times don't reveal which usernames exist.
 */
export async function verifyAgainstDummy(secret: string): Promise<false> {
  dummyHash ??= hashSecret(randomBytes(16).toString('hex'));
  await verifySecret(await dummyHash, secret);
  return false;
}

/** A new `hp_session` token (256 random bits) and the hash stored in `sessions.token_hash`. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

/**
 * SHA-256 is enough here: the token is 256 random bits, so there's nothing to
 * brute-force, and a fast hash keeps the per-request lookup cheap.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh recovery code (~59 bits), normalized (no dashes). */
export function newRecoveryCode(): string {
  return Array.from({ length: RECOVERY_CODE_LENGTH }, () =>
    RECOVERY_CODE_ALPHABET.charAt(randomInt(RECOVERY_CODE_ALPHABET.length)),
  ).join('');
}

/** A temporary password for operator resets, e.g. ABCD-EFGH-JKMN. */
export function newTemporaryPassword(): string {
  return formatRecoveryCode(newRecoveryCode());
}

/**
 * Constant-time string comparison. Hashing first gives equal-length inputs,
 * so neither the content nor the length of the secret leaks through timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Fresh credentials for a password reset by someone else (operator or map
 * owner): a temporary password and recovery code to show once, formatted, and
 * the hashes to store with `AuthRepo.resetPassword`.
 */
export async function newResetCredentials(): Promise<{
  temporaryPassword: string;
  recoveryCode: string;
  passwordHash: string;
  newRecoveryCodeHash: string;
}> {
  const temporaryPassword = newTemporaryPassword();
  const recoveryCode = newRecoveryCode();
  const [passwordHash, newRecoveryCodeHash] = await Promise.all([
    hashSecret(temporaryPassword),
    hashSecret(recoveryCode),
  ]);
  return {
    temporaryPassword,
    recoveryCode: formatRecoveryCode(recoveryCode),
    passwordHash,
    newRecoveryCodeHash,
  };
}
