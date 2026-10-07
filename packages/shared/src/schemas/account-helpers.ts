import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PublicUserSchema } from './auth.js';

// Grown-up helpers and new recovery codes (#197, owner decisions 2026-10-07).
// A helper is picked from a list the server makes, never typed, so nothing
// here takes a username: no endpoint can tell you whether a name exists.

/** Why someone is on your list of possible helpers. */
export const HelperReasonSchema = z.enum(['invited-you', 'patch-owner', 'patch-mate']);
export type HelperReason = z.infer<typeof HelperReasonSchema>;

/** Someone you could ask: who brought you in, or someone you share a patch with. */
export const HelperCandidateSchema = z.object({
  user: PublicUserSchema,
  reason: HelperReasonSchema,
  /** The patch you share, for `patch-owner` and `patch-mate`. */
  patchName: z.string().nullable(),
});
export type HelperCandidate = z.infer<typeof HelperCandidateSchema>;

/** `GET /api/v1/account/helpers/candidates` */
export const HelperCandidatesResponseSchema = z.object({
  candidates: z.array(HelperCandidateSchema),
});
export type HelperCandidatesResponse = z.infer<typeof HelperCandidatesResponseSchema>;

/** `pending`: asked, not answered yet. `active`: they said yes. */
export const HelperLinkStatusSchema = z.enum(['pending', 'active']);
export type HelperLinkStatus = z.infer<typeof HelperLinkStatusSchema>;

export const MyHelperSchema = z.object({
  user: PublicUserSchema,
  status: HelperLinkStatusSchema,
});
export type MyHelper = z.infer<typeof MyHelperSchema>;

/**
 * `GET /api/v1/account/helpers`, and the reply to every helper command: both
 * sides of your links. A "no" or a removal just drops the row.
 */
export const AccountHelpersResponseSchema = z.object({
  /** Your helpers and the asks you sent, oldest first. */
  helpers: z.array(MyHelperSchema),
  /** False once you have as many helpers (and asks) as allowed. */
  canAddHelper: z.boolean(),
  /** Players asking you to be their helper, oldest first. */
  asks: z.array(PublicUserSchema),
  /** Players you help, by name. */
  helping: z.array(PublicUserSchema),
});
export type AccountHelpersResponse = z.infer<typeof AccountHelpersResponseSchema>;

/** `POST /api/v1/account/helpers`: ask someone from your candidate list. */
export const AskHelperRequestSchema = z.object({ helperId: z.uuid() });
export type AskHelperRequest = z.infer<typeof AskHelperRequestSchema>;

/** `/account/helpers/:userId/…` (your helper) and `/account/helping/:userId/…` (a player you help). */
export const HelperUserParamsSchema = z.object({ userId: z.uuid() });

/** `POST /api/v1/auth/recovery-code`: a new code, if you know your password. */
export const NewRecoveryCodeRequestSchema = z.object({
  password: z.string().min(1, 'Type your password.').max(PASSWORD_MAX_LENGTH),
});
export type NewRecoveryCodeRequest = z.infer<typeof NewRecoveryCodeRequestSchema>;

/** Shown once; the old code stops working. */
export const NewRecoveryCodeResponseSchema = z.object({ recoveryCode: z.string() });
export type NewRecoveryCodeResponse = z.infer<typeof NewRecoveryCodeResponseSchema>;
