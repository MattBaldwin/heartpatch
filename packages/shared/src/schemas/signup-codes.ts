import { z } from 'zod';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode } from './maps.js';

// Family signup codes (#195): a patch owner or the operator makes one so a new
// family can make accounts. Stored hashed (shown once), like recovery codes.

/** Same look-alike-free alphabet as invite codes. */
export const SIGNUP_CODE_ALPHABET = INVITE_CODE_ALPHABET;
/**
 * Longer than an invite (8), so the sign-up screen's one code field can tell
 * the two apart by length, and the stored hash isn't a quick offline guess.
 */
export const SIGNUP_CODE_LENGTH = 12;

/** Uppercases and drops spaces and dashes, like invite codes. */
export const normalizeSignupCode = normalizeInviteCode;

/** What a typed code looks like: a family code, a patch invite, or neither (the old bootstrap code). */
export function signupCodeShape(input: string): 'family' | 'invite' | 'other' {
  const code = normalizeSignupCode(input);
  if (!new RegExp(`^[${SIGNUP_CODE_ALPHABET}]+$`).test(code)) return 'other';
  if (code.length === SIGNUP_CODE_LENGTH) return 'family';
  if (code.length === INVITE_CODE_LENGTH) return 'invite';
  return 'other';
}

/** ABCD-EFGH-JKMN. */
export function formatSignupCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

export const SIGNUP_CODE_LABEL_MAX = 30;

/** Who the code is for ("Smith family"). Filtered on the server like any player text. */
export const SignupCodeLabelSchema = z
  .string()
  .trim()
  .min(1, "Say who it's for, like “Lee family”.")
  .max(SIGNUP_CODE_LABEL_MAX, `Keep it short: ${String(SIGNUP_CODE_LABEL_MAX)} letters or fewer.`);

/** `POST /api/v1/signup-codes` */
export const CreateSignupCodeRequestSchema = z.object({ label: SignupCodeLabelSchema });
export type CreateSignupCodeRequest = z.infer<typeof CreateSignupCodeRequestSchema>;

export const SignupCodeStatusSchema = z.enum(['live', 'used_up', 'expired', 'revoked']);
export type SignupCodeStatus = z.infer<typeof SignupCodeStatusSchema>;

/** A code as its maker sees it. The code itself is never sent again. */
export const SignupCodeSummarySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  status: SignupCodeStatusSchema,
  uses: z.number().int().nonnegative(),
  maxUses: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  /** Usernames that signed up with it, oldest first. */
  usedBy: z.array(z.string()),
});
export type SignupCodeSummary = z.infer<typeof SignupCodeSummarySchema>;

/** `GET /api/v1/signup-codes`: live codes first, then recently ended ones. */
export const MySignupCodesResponseSchema = z.object({
  codes: z.array(SignupCodeSummarySchema),
  /** How many live codes one owner may have at once. */
  liveMax: z.number().int().positive(),
});
export type MySignupCodesResponse = z.infer<typeof MySignupCodesResponseSchema>;

/** `POST /api/v1/signup-codes` (201): the only time the code is shown. */
export const CreateSignupCodeResponseSchema = z.object({
  code: z.string(),
  signupCode: SignupCodeSummarySchema,
});
export type CreateSignupCodeResponse = z.infer<typeof CreateSignupCodeResponseSchema>;

/** `/api/v1/signup-codes/:codeId/...` */
export const SignupCodeParamsSchema = z.object({ codeId: z.uuid() });
