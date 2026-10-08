import { z } from 'zod';
import { PvpModeSchema } from './maps.js';
import { queryBool, queryInt } from './query.js';
import { SignupCodeLabelSchema, SignupCodeSummarySchema } from './signup-codes.js';
import { LocalDateSchema } from './time.js';

// The operator admin console (#196): `/api/v1/admin/*`, admins only. Admin is
// a role a host script grants (`ops/grant-admin.ts`), never an HTTP route, and
// every sign-in needs a code from the admin's authenticator app (TOTP).

/** An admin session ends after this long without a request (#196). */
export const ADMIN_IDLE_MINUTES = 30; // TUNE: issue #196

/** And ends this long after sign-in regardless. */
export const ADMIN_MAX_HOURS = 8; // TUNE: guess

/** Rows per page on every admin list. */
export const ADMIN_PAGE_SIZE = 25; // TUNE: guess

/** Six digits from an authenticator app; spaces are allowed ("123 456"). */
export const TotpCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Type the 6 digits from your authenticator app.'));

/** `POST /api/v1/admin/login` */
export const AdminLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
  code: TotpCodeSchema,
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

/** `GET /api/v1/admin/me` and the reply to a sign-in. */
export const AdminMeResponseSchema = z.object({
  admin: z.object({ id: z.uuid(), username: z.string() }),
  /** When the session ends if nothing else is done. */
  idleExpiresAt: z.iso.datetime(),
  /** When it ends regardless. */
  expiresAt: z.iso.datetime(),
});
export type AdminMeResponse = z.infer<typeof AdminMeResponseSchema>;

/** `?q=&page=` on the admin lists. */
export const AdminListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  page: queryInt({ min: 1, max: 10_000 }).optional(),
});
export type AdminListQuery = z.infer<typeof AdminListQuerySchema>;

/** `GET /api/v1/admin/patches` adds `?tutorial=true` to include tutorial runs. */
export const AdminPatchesQuerySchema = AdminListQuerySchema.extend({
  tutorial: queryBool().optional(),
});
export type AdminPatchesQuery = z.infer<typeof AdminPatchesQuerySchema>;

const PageSchema = {
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
};

export const AdminPatchSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(['multiplayer', 'tutorial']),
  owner: z.string().nullable(),
  members: z.number().int().nonnegative(),
  maxPlayers: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  /** The latest game event on it; null before any. */
  lastActivityAt: z.iso.datetime().nullable(),
  /** Season names active on the patch's own date. */
  seasons: z.array(z.string()),
  pvpMode: PvpModeSchema,
  pendingRequests: z.number().int().nonnegative(),
});
export type AdminPatchSummary = z.infer<typeof AdminPatchSummarySchema>;

export const AdminPatchesResponseSchema = z.object({
  patches: z.array(AdminPatchSummarySchema),
  ...PageSchema,
});
export type AdminPatchesResponse = z.infer<typeof AdminPatchesResponseSchema>;

export const AdminPatchParamsSchema = z.object({ mapId: z.uuid() });
export const AdminRequestParamsSchema = z.object({ mapId: z.uuid(), requestId: z.uuid() });
export const AdminPlayerParamsSchema = z.object({ userId: z.uuid() });
export const AdminCodeParamsSchema = z.object({ codeId: z.uuid() });

/** `GET /api/v1/admin/patches/:mapId` */
export const AdminPatchDetailSchema = z.object({
  patch: AdminPatchSummarySchema.extend({
    timeZone: z.string(),
    /**
     * Trading posts on the patch (#269): 0 on a tutorial run, and on an older
     * patch until the boot pass finds a fair spot free. Optional only so an
     * older server's reply parses.
     */
    tradingPosts: z.number().int().nonnegative().optional(),
  }),
  members: z.array(
    z.object({
      userId: z.uuid(),
      username: z.string(),
      role: z.enum(['owner', 'member']),
      joinedAt: z.iso.datetime(),
      /** Their latest game event on this patch; null before any. */
      lastActiveAt: z.iso.datetime().nullable(),
    }),
  ),
  requests: z.array(
    z.object({
      id: z.uuid(),
      userId: z.uuid(),
      username: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  /** The live invite code's expiry. The code itself needs `invite/reveal`. */
  invite: z.object({ expiresAt: z.iso.datetime() }).nullable(),
  /** The Hollow Man's latest nights, newest first. */
  nights: z.array(
    z.object({
      night: LocalDateSchema,
      players: z.array(
        z.object({
          username: z.string(),
          /** A squishy was taken that night. */
          taken: z.boolean(),
          sheltered: z.number().int().nonnegative(),
          exposed: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
});
export type AdminPatchDetail = z.infer<typeof AdminPatchDetailSchema>;

/** `POST /api/v1/admin/patches/:mapId/invite/reveal` and `/invite` (a new one). */
export const AdminInviteResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});
export type AdminInviteResponse = z.infer<typeof AdminInviteResponseSchema>;

export const AdminPlayerSummarySchema = z.object({
  id: z.uuid(),
  username: z.string(),
  role: z.enum(['player', 'admin']),
  createdAt: z.iso.datetime(),
  /** The newest still-signed-in device's sign-in; null when none is. */
  lastSignInAt: z.iso.datetime().nullable(),
  activeSessions: z.number().int().nonnegative(),
  /** Whether an unused recovery code exists. Never the code. */
  hasRecoveryCode: z.boolean(),
  patches: z.number().int().nonnegative(),
});
export type AdminPlayerSummary = z.infer<typeof AdminPlayerSummarySchema>;

export const AdminPlayersResponseSchema = z.object({
  players: z.array(AdminPlayerSummarySchema),
  ...PageSchema,
});
export type AdminPlayersResponse = z.infer<typeof AdminPlayersResponseSchema>;

export const AdminPlayerPatchStatusSchema = z.enum(['owner', 'member', 'requested', 'left']);

/** `GET /api/v1/admin/players/:userId` */
export const AdminPlayerDetailSchema = z.object({
  player: AdminPlayerSummarySchema,
  /** Who brought them in (#195): the family code's label and its maker, or a patch owner. */
  broughtInBy: z.object({
    signupCodeLabel: z.string().nullable(),
    invitedBy: z.string().nullable(),
  }),
  patches: z.array(
    z.object({
      mapId: z.uuid(),
      name: z.string(),
      status: AdminPlayerPatchStatusSchema,
      since: z.iso.datetime(),
    }),
  ),
});
export type AdminPlayerDetail = z.infer<typeof AdminPlayerDetailSchema>;

/** `POST /api/v1/admin/players/:userId/reset-password`: shown once. */
export const AdminResetPasswordResponseSchema = z.object({
  username: z.string(),
  temporaryPassword: z.string(),
  recoveryCode: z.string(),
});
export type AdminResetPasswordResponse = z.infer<typeof AdminResetPasswordResponseSchema>;

/** `POST /api/v1/admin/players/:userId/logout-everywhere`: how many sessions ended. */
export const AdminLogoutEverywhereResponseSchema = z.object({
  ended: z.number().int().nonnegative(),
});

/** `GET /api/v1/admin/signup-codes`: every maker's codes. */
export const AdminSignupCodesResponseSchema = z.object({
  codes: z.array(SignupCodeSummarySchema.extend({ createdBy: z.string().nullable() })),
});
export type AdminSignupCodesResponse = z.infer<typeof AdminSignupCodesResponseSchema>;

/** `POST /api/v1/admin/signup-codes` */
export const AdminCreateSignupCodeRequestSchema = z.object({
  label: SignupCodeLabelSchema,
  maxUses: z.number().int().min(1).max(1000), // TUNE: as ops/signup-code.ts --uses
  days: z.number().int().min(1).max(365), // TUNE: as ops/signup-code.ts --days
});
export type AdminCreateSignupCodeRequest = z.infer<typeof AdminCreateSignupCodeRequestSchema>;

/** `POST /api/v1/admin/signup-codes/:codeId/extend` */
export const AdminExtendSignupCodeRequestSchema = z.object({
  days: z.number().int().min(1).max(90), // TUNE: guess
});

/** `POST /api/v1/admin/lookup`: "forgot my username" from what a parent knows. */
export const AdminLookupRequestSchema = z
  .object({
    patch: z.string().trim().min(2).max(40),
    from: LocalDateSchema,
    to: LocalDateSchema,
  })
  .refine((v) => v.from <= v.to, { message: 'The start must be before the end.' });
export type AdminLookupRequest = z.infer<typeof AdminLookupRequestSchema>;

/** At most this many matches; narrow the search for more. */
export const ADMIN_LOOKUP_MAX = 10; // TUNE: guess

export const AdminLookupResponseSchema = z.object({
  matches: z.array(
    z.object({
      userId: z.uuid(),
      username: z.string(),
      mapName: z.string(),
      status: AdminPlayerPatchStatusSchema,
      since: z.iso.datetime(),
    }),
  ),
});
export type AdminLookupResponse = z.infer<typeof AdminLookupResponseSchema>;

export const AdminAuditEntrySchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  /** The admin's username; null for a host script. */
  actor: z.string().nullable(),
  action: z.string(),
  targetUser: z.string().nullable(),
  targetMap: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
  outcome: z.enum(['pending', 'done', 'failed']),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

/** `GET /api/v1/admin/audit`, newest first. */
export const AdminAuditResponseSchema = z.object({
  entries: z.array(AdminAuditEntrySchema),
  ...PageSchema,
});
export type AdminAuditResponse = z.infer<typeof AdminAuditResponseSchema>;
