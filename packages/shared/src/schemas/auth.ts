import { z } from 'zod';
import { TimeZoneSchema } from './time.js';

// Account API schemas (design doc §18, tech spec §5 and §9). Messages are
// kid-readable (style guide §6): the client shows them next to the field.

export const USERNAME_MIN_LENGTH = 3; // TUNE: guess
export const USERNAME_MAX_LENGTH = 16; // TUNE: fits a name tag on a phone screen
export const PASSWORD_MIN_LENGTH = 8; // TUNE: guess
/** Upper bound so a huge body can't make Argon2 hash megabytes. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Letters, numbers and underscores. Uniqueness is case-insensitive
 * ("Pumpkin" and "pumpkin" are the same player); the server also runs the
 * text filter.
 */
export const UsernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `Names need at least ${USERNAME_MIN_LENGTH} letters or numbers.`)
  .max(USERNAME_MAX_LENGTH, `Names can be up to ${USERNAME_MAX_LENGTH} letters or numbers.`)
  .regex(/^[A-Za-z0-9_]+$/, 'Names can use letters, numbers and _ only.');

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, 'That password is a bit too long.');

/**
 * Wide bounds matching the database check. The server also rejects years in
 * the future, since only it knows today's date.
 */
export const BirthYearSchema = z
  .number('Pick the year you were born.')
  .int('Pick the year you were born.')
  .min(1900, 'Pick the year you were born.')
  .max(2100, 'Pick the year you were born.');

// Moved to schemas/time.ts; re-exported so existing imports keep working.
export { TimeZoneSchema } from './time.js';

// Recovery codes: 12 characters from an alphabet with no look-alikes (no 0/O,
// 1/I/L, and no U), shown as ABCD-EFGH-JKMN (tech spec §9).
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_LENGTH = 12;

/** Uppercases and drops spaces and dashes, so "abcd efgh-jkmn" works too. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** Groups a code in fours for display: ABCD-EFGH-JKMN. */
export function formatRecoveryCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

export const RecoveryCodeSchema = z
  .string()
  .transform(normalizeRecoveryCode)
  .pipe(
    z
      .string()
      .length(RECOVERY_CODE_LENGTH, 'Recovery codes have 12 letters and numbers.')
      .regex(
        new RegExp(`^[${RECOVERY_CODE_ALPHABET}]+$`),
        "That doesn't look like a recovery code. Check it and try again!",
      ),
  );

/** The family signup code from the operator (decision D). */
export const SignupCodeSchema = z
  .string()
  .trim()
  .min(1, 'Ask a grown-up for the family code.')
  .max(128, 'That family code is too long.');

/** `POST /api/v1/auth/signup` */
export const SignupRequestSchema = z.object({
  signupCode: SignupCodeSchema,
  username: UsernameSchema,
  password: PasswordSchema,
  birthYear: BirthYearSchema,
  timeZone: TimeZoneSchema,
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/**
 * `POST /api/v1/auth/login`. Only shape checks here: a wrong-length password
 * is just a wrong password.
 */
export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Type your name.').max(64),
  password: z.string().min(1, 'Type your password.').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** `POST /api/v1/auth/recover`: set a new password with the recovery code. */
export const RecoverRequestSchema = z.object({
  username: z.string().trim().min(1, 'Type your name.').max(64),
  recoveryCode: RecoveryCodeSchema,
  newPassword: PasswordSchema,
});
export type RecoverRequest = z.infer<typeof RecoverRequestSchema>;

/** What any player may see about an account. */
export const PublicUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** `POST /auth/login` response. */
export const SessionResponseSchema = z.object({ user: PublicUserSchema });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/**
 * `POST /auth/signup` and `POST /auth/recover` responses: the player is logged
 * in and gets a fresh recovery code to save. It is shown once and never again.
 */
export const RecoveryCodeResponseSchema = z.object({
  user: PublicUserSchema,
  recoveryCode: z.string(),
});
export type RecoveryCodeResponse = z.infer<typeof RecoveryCodeResponseSchema>;

/** `GET /api/v1/me`: the logged-in player, or null when logged out. */
export const MeResponseSchema = z.object({ user: PublicUserSchema.nullable() });
export type MeResponse = z.infer<typeof MeResponseSchema>;
