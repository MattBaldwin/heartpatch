import {
  ADMIN_LOOKUP_MAX,
  ADMIN_PAGE_SIZE,
  activeSeasons,
  formatInviteCode,
  GAME_DATA,
  type AdminAuditResponse,
  type AdminCreateSignupCodeRequest,
  type AdminInviteResponse,
  type AdminLoginRequest,
  type AdminLookupRequest,
  type AdminLookupResponse,
  type AdminMeResponse,
  type AdminPatchDetail,
  type AdminPatchSummary,
  type AdminPatchesQuery,
  type AdminPatchesResponse,
  type AdminPlayerDetail,
  type AdminPlayersResponse,
  type AdminResetPasswordResponse,
  type AdminSignupCodesResponse,
  type AdminListQuery,
  type CreateSignupCodeResponse,
} from '@heartpatch/shared';
import { z } from 'zod';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import {
  hashSessionToken,
  newSessionToken,
  verifyAgainstDummy,
  verifySecret,
} from '../auth/secrets.js';
import type { AuthService } from '../auth/service.js';
import { createMapsRepo } from '../maps/repo.js';
import type { MapsService } from '../maps/service.js';
import type { SignupCodesService } from '../signup-codes/service.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { ADMIN_RULES } from './limits.js';
import { createAdminRepo, type AuditInput, type PatchRow, type PlayerRow } from './repo.js';
import { matchTotp } from './totp.js';

/** The signed-in admin behind a request. */
export interface AdminUser {
  id: string;
  username: string;
}

export interface IssuedAdminSession {
  token: string;
  /** The cookie's own expiry: the session's hard end. */
  expiresAt: Date;
}

/** Where an action came from, for its audit row. */
export interface AdminContext {
  admin: AdminUser;
  ip: string;
}

export interface AdminServiceOptions {
  db: Executor;
  auth: AuthService;
  maps: MapsService;
  signupCodes: SignupCodesService;
  /** Sessions and authenticator codes: real time by default (see `BuildAppOptions.adminNow`). */
  now?: Clock | undefined;
  /** The game clock, for game data (seasons, invite and code expiry, player sessions). */
  clock?: Clock | undefined;
  /** Where an audit write that fails after its action is reported (`app.log`). */
  log?: AuditLog | undefined;
}

/** The slice of a pino logger the audit needs. */
export interface AuditLog {
  error: (obj: object, msg: string) => void;
}

// The console is for grown-ups, but stays plain and friendly (style guide §6).
const MESSAGES = {
  signIn: "That didn't work. Check your username, password and authenticator code.",
  notFoundPatch: "We couldn't find that patch.",
  notFoundPlayer: "We couldn't find that player.",
  notFoundRequest: "We couldn't find that request. It may have been answered already.",
  noInvite: 'This patch has no live invite code. Make a new one.',
  tutorial: 'Tutorial runs have no invite codes or join requests.',
  notRevoked: "We couldn't find that code, or it's already turned off.",
  notFoundCode:
    "That code can't be extended: it's gone, turned off, or a patch owner's code that has ended.",
} as const;

/** One player's night, as `hollow_events.outcomes` stores it; a row that doesn't fit is dropped. */
const NightOutcomeSchema = z.object({
  userId: z.string(),
  // One id or null before #277; a list since (he can take up to 3).
  taken: z.union([z.array(z.string()), z.string().nullable()]),
  exposed: z.number().int().nonnegative(),
  sheltered: z.number().int().nonnegative(),
  reclaimed: z.array(z.unknown()).optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** A local date can start up to 14 h before, and end 12 h after, its UTC day. */
const ZONE_SLACK_MS = 14 * 60 * 60 * 1000;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

function pageOf(query: AdminListQuery): { page: number; offset: number } {
  const page = query.page ?? 1;
  return { page, offset: (page - 1) * ADMIN_PAGE_SIZE };
}

export function createAdminService(options: AdminServiceOptions) {
  const { db, auth, maps, signupCodes } = options;
  const now = options.now ?? (() => new Date());
  const gameNow = options.clock ?? (() => new Date());
  const repo = createAdminRepo(db);
  const mapsRepo = createMapsRepo(db);

  /** Marks an audit row; a failure here is logged, never allowed to hide what the action did. */
  const finish = async (auditId: string, outcome: 'done' | 'failed') => {
    try {
      await repo.finishAudit(auditId, outcome);
    } catch (err) {
      options.log?.error({ err, auditId, outcome }, 'admin audit: could not record the outcome');
    }
  };

  /**
   * Runs an action between a `pending` audit row and its outcome, so every
   * action is on record even if it fails or the process stops midway. The
   * checks an action makes (does the patch exist?) run inside, so a refused
   * action is recorded too. Once the action has run, its result (a reset's
   * one-time secrets) always reaches the admin, even if the outcome can't be
   * written: the row then stays `pending`.
   */
  const audited = async <T>(input: AuditInput, run: () => Promise<T>): Promise<T> => {
    const auditId = await repo.audit(input);
    let result: T;
    try {
      result = await run();
    } catch (err) {
      await finish(auditId, 'failed');
      throw err;
    }
    await finish(auditId, 'done');
    return result;
  };

  /** Audit targets that exist (the columns are foreign keys); a missing one goes in `detail`. */
  const targets = async (ids: { mapId?: string; userId?: string }) => {
    const [patch, username] = await Promise.all([
      ids.mapId === undefined ? null : repo.findPatch(ids.mapId),
      ids.userId === undefined ? null : repo.findUsername(ids.userId),
    ]);
    const missing: Record<string, string> = {};
    if (ids.mapId !== undefined && !patch) missing['mapId'] = ids.mapId;
    if (ids.userId !== undefined && username === null) missing['userId'] = ids.userId;
    return {
      patch,
      username,
      input: {
        targetMapId: patch ? patch.id : null,
        targetUserId: username === null ? null : (ids.userId ?? null),
      },
      missing,
    };
  };

  const toPatch = (row: PatchRow): AdminPatchSummary => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    owner: row.owner,
    members: row.members,
    maxPlayers: row.maxPlayers,
    createdAt: iso(row.createdAt),
    lastActivityAt: isoOrNull(row.lastActivityAt),
    seasons: activeSeasons(GAME_DATA.seasons, localDate(gameNow(), row.timeZone)).map(
      (s) => s.name,
    ),
    pvpMode: row.pvpMode,
    pendingRequests: row.pendingRequests,
  });

  const toPlayer = (row: PlayerRow) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: iso(row.createdAt),
    lastSignInAt: isoOrNull(row.lastSignInAt),
    activeSessions: row.activeSessions,
    hasRecoveryCode: row.hasRecoveryCode,
    patches: row.patches,
  });

  /** A patch (not a tutorial run), or NOT_FOUND. */
  const requirePatch = (patch: PatchRow | null): PatchRow => {
    if (!patch) throw new AppError('NOT_FOUND', MESSAGES.notFoundPatch);
    if (patch.kind !== 'multiplayer') throw new AppError('NOT_FOUND', MESSAGES.tutorial);
    return patch;
  };

  /**
   * The patch's owner, whom invite and join-request commands run as: the
   * maps module's own rules (seats, the Keeper and tutorial gates, events and
   * lock order) then apply unchanged.
   */
  const ownerOf = async (patch: PatchRow | null) => {
    const owner = await mapsRepo.owner(requirePatch(patch).id);
    if (!owner) throw new AppError('NOT_FOUND', MESSAGES.notFoundPatch);
    return owner;
  };

  const requirePlayer = (username: string | null): string => {
    if (username === null) throw new AppError('NOT_FOUND', MESSAGES.notFoundPlayer);
    return username;
  };

  return {
    /**
     * Password, then the authenticator code, for an account with the admin
     * role and a confirmed authenticator. Every failure looks the same.
     */
    login: async (
      input: AdminLoginRequest,
      ip: string,
    ): Promise<{ session: IssuedAdminSession; me: AdminMeResponse }> => {
      const at = now();
      const account = await repo.findAccount(input.username);
      const passwordOk = account
        ? await verifySecret(account.passwordHash, input.password)
        : await verifyAgainstDummy(input.password);
      const isAdmin = account?.role === 'admin';
      const totp = isAdmin && account.totp?.enrolledAt ? account.totp : null;
      const step =
        passwordOk && totp ? matchTotp(totp.secret, input.code, at, totp.lastStep) : null;
      const ok = account && step !== null && (await repo.useTotpStep(account.id, step));
      if (!account || !ok) {
        // Failed tries on an admin account are worth seeing (a guessed password).
        if (isAdmin) {
          await repo.audit(
            {
              actorUserId: account.id,
              action: AUDIT_ACTIONS.signIn,
              detail: { reason: passwordOk ? 'code' : 'password' },
              ip,
            },
            'failed',
          );
        }
        throw new AppError('UNAUTHENTICATED', MESSAGES.signIn);
      }
      const { token, tokenHash } = newSessionToken();
      const expiresAt = new Date(at.getTime() + ADMIN_RULES.maxMs);
      await repo.createSession({ userId: account.id, tokenHash, now: at, expiresAt });
      await repo.audit({ actorUserId: account.id, action: AUDIT_ACTIONS.signIn, ip }, 'done');
      return {
        session: { token, expiresAt },
        me: {
          admin: { id: account.id, username: account.username },
          idleExpiresAt: iso(new Date(at.getTime() + ADMIN_RULES.idleMs)),
          expiresAt: iso(expiresAt),
        },
      };
    },

    /** The admin behind a token, re-checked and touched on every request; null otherwise. */
    authenticate: async (token: string | undefined): Promise<AdminMeResponse | null> => {
      if (!token) return null;
      const at = now();
      const found = await repo.touchSession(
        hashSessionToken(token),
        at,
        new Date(at.getTime() - ADMIN_RULES.idleMs),
      );
      if (!found) return null;
      return {
        admin: found.user,
        idleExpiresAt: iso(new Date(at.getTime() + ADMIN_RULES.idleMs)),
        expiresAt: iso(found.expiresAt),
      };
    },

    logout: async (token: string | undefined, admin: AdminUser | null, ip: string) => {
      if (!token) return;
      await repo.deleteSession(hashSessionToken(token));
      if (admin)
        await repo.audit({ actorUserId: admin.id, action: AUDIT_ACTIONS.signOut, ip }, 'done');
    },

    // --- Patches -----------------------------------------------------------

    patches: async (query: AdminPatchesQuery): Promise<AdminPatchesResponse> => {
      const { page, offset } = pageOf(query);
      const { rows, total } = await repo.listPatches(
        { q: query.q || undefined, tutorial: query.tutorial ?? false },
        ADMIN_PAGE_SIZE,
        offset,
      );
      return { patches: rows.map(toPatch), page, pageSize: ADMIN_PAGE_SIZE, total };
    },

    patch: async (mapId: string): Promise<AdminPatchDetail> => {
      const row = await repo.findPatch(mapId);
      if (!row) throw new AppError('NOT_FOUND', MESSAGES.notFoundPatch);
      const [members, requests, invite, nights] = await Promise.all([
        repo.patchMembers(mapId),
        repo.pendingRequests(mapId),
        mapsRepo.liveInvite(mapId, gameNow()),
        repo.recentNights(mapId, ADMIN_RULES.nightsShown),
      ]);
      const outcomes = nights.map((n) => ({
        night: n.night,
        outcomes: z.array(NightOutcomeSchema).catch([]).parse(n.outcomes),
      }));
      const names = await repo.usernames([
        ...new Set(outcomes.flatMap((n) => n.outcomes.map((o) => o.userId))),
      ]);
      return {
        patch: {
          ...toPatch(row),
          timeZone: row.timeZone,
          hollowStrengthPercent: row.hollowStrengthPercent,
        },
        members: members.map((m) => ({
          ...m,
          joinedAt: iso(m.joinedAt),
          lastActiveAt: isoOrNull(m.lastActiveAt),
        })),
        requests: requests.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
        invite: invite ? { expiresAt: iso(invite.expiresAt) } : null,
        nights: outcomes.map((n) => ({
          night: n.night,
          players: n.outcomes.map((o) => ({
            username: names.get(o.userId) ?? '(gone)',
            taken: Array.isArray(o.taken) ? o.taken.length > 0 : o.taken !== null,
            reclaimed: o.reclaimed?.length ?? 0,
            sheltered: o.sheltered,
            exposed: o.exposed,
          })),
        })),
      };
    },

    /** The live invite code, shown on request and recorded. */
    revealInvite: async (ctx: AdminContext, mapId: string): Promise<AdminInviteResponse> => {
      const found = await targets({ mapId });
      return audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.revealInvite,
          ...found.input,
          detail: found.missing,
          ip: ctx.ip,
        },
        async () => {
          requirePatch(found.patch);
          const invite = await mapsRepo.liveInvite(mapId, gameNow());
          if (!invite) throw new AppError('NOT_FOUND', MESSAGES.noInvite);
          return { code: formatInviteCode(invite.code), expiresAt: iso(invite.expiresAt) };
        },
      );
    },

    /** A new invite code as the owner would make it; the old one stops working. */
    newInvite: async (ctx: AdminContext, mapId: string): Promise<AdminInviteResponse> => {
      const found = await targets({ mapId });
      return audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.newInvite,
          ...found.input,
          detail: found.missing,
          ip: ctx.ip,
        },
        async () => maps.regenerateInvite(await ownerOf(found.patch), mapId),
      );
    },

    /**
     * Sets a patch's "Hollow Man strength" (#277, owner decision 2026-10-08
     * Q4): his strike chances there, from the next nightfall. Never his caps.
     */
    setHollowStrength: async (ctx: AdminContext, mapId: string, percent: number): Promise<void> => {
      const found = await targets({ mapId });
      await audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.hollowStrength,
          ...found.input,
          detail: { ...found.missing, percent, was: found.patch?.hollowStrengthPercent ?? null },
          ip: ctx.ip,
        },
        async () => {
          requirePatch(found.patch);
          if (!(await repo.setHollowStrength(mapId, percent))) {
            throw new AppError('NOT_FOUND', MESSAGES.notFoundPatch);
          }
        },
      );
    },

    /** Approves or declines a join request, as the owner (the maps module's rules apply). */
    answerRequest: async (
      ctx: AdminContext,
      mapId: string,
      requestId: string,
      answer: 'approve' | 'decline',
    ): Promise<void> => {
      const found = await targets({ mapId });
      const request = found.patch
        ? (await repo.pendingRequests(mapId)).find((r) => r.id === requestId)
        : undefined;
      await audited(
        {
          actorUserId: ctx.admin.id,
          action: answer === 'approve' ? AUDIT_ACTIONS.approve : AUDIT_ACTIONS.decline,
          ...found.input,
          targetUserId: request?.userId ?? null,
          detail: { requestId, ...found.missing },
          ip: ctx.ip,
        },
        async () => {
          const owner = await ownerOf(found.patch);
          if (!request) throw new AppError('NOT_FOUND', MESSAGES.notFoundRequest);
          await (answer === 'approve'
            ? maps.approve(owner, mapId, requestId)
            : maps.deny(owner, mapId, requestId));
        },
      );
    },

    // --- Players -----------------------------------------------------------

    players: async (query: AdminListQuery): Promise<AdminPlayersResponse> => {
      const { page, offset } = pageOf(query);
      const { rows, total } = await repo.listPlayers(
        query.q || undefined,
        gameNow(),
        ADMIN_PAGE_SIZE,
        offset,
      );
      return { players: rows.map(toPlayer), page, pageSize: ADMIN_PAGE_SIZE, total };
    },

    player: async (userId: string): Promise<AdminPlayerDetail> => {
      const row = await repo.findPlayer(userId, gameNow());
      if (!row) throw new AppError('NOT_FOUND', MESSAGES.notFoundPlayer);
      const patches = await repo.playerPatches(userId);
      return {
        player: toPlayer(row),
        broughtInBy: { signupCodeLabel: row.signupCodeLabel, invitedBy: row.invitedBy },
        patches: patches.map((p) => ({ ...p, since: iso(p.since) })),
      };
    },

    /**
     * The operator reset (tech spec §9), the same one `ops/reset-password.ts`
     * runs: a temporary password and a new recovery code, shown once, and
     * every session ended. The secrets are never logged or audited.
     */
    resetPassword: async (
      ctx: AdminContext,
      userId: string,
    ): Promise<AdminResetPasswordResponse> => {
      const found = await targets({ userId });
      return audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.resetPassword,
          ...found.input,
          detail: found.missing,
          ip: ctx.ip,
        },
        async () => {
          const result = await auth.operatorReset(requirePlayer(found.username));
          if (!result) throw new AppError('NOT_FOUND', MESSAGES.notFoundPlayer);
          return {
            username: result.user.username,
            temporaryPassword: result.temporaryPassword,
            recoveryCode: result.recoveryCode,
          };
        },
      );
    },

    /** Ends every one of a player's sessions. Their password stays. */
    logoutEverywhere: async (ctx: AdminContext, userId: string): Promise<{ ended: number }> => {
      const found = await targets({ userId });
      return audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.logoutEverywhere,
          ...found.input,
          detail: found.missing,
          ip: ctx.ip,
        },
        async () => {
          requirePlayer(found.username);
          return { ended: await repo.deleteSessions(userId) };
        },
      );
    },

    /** "Forgot my username": from a patch name and roughly when they joined. */
    lookup: async (ctx: AdminContext, input: AdminLookupRequest): Promise<AdminLookupResponse> =>
      audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.lookup,
          detail: { patch: input.patch, from: input.from, to: input.to },
          ip: ctx.ip,
        },
        async () => {
          // Dates are the parent's, in some time zone: widen to cover any.
          const from = new Date(Date.parse(`${input.from}T00:00:00Z`) - ZONE_SLACK_MS);
          const to = new Date(Date.parse(`${input.to}T00:00:00Z`) + DAY_MS + ZONE_SLACK_MS);
          const rows = await repo.lookup(input.patch, from, to, ADMIN_LOOKUP_MAX);
          return { matches: rows.map((r) => ({ ...r, since: iso(r.since) })) };
        },
      ),

    // --- Family codes (#195) ---------------------------------------------

    signupCodes: async (): Promise<AdminSignupCodesResponse> => ({
      codes: await signupCodes.operatorList(),
    }),

    createSignupCode: async (
      ctx: AdminContext,
      input: AdminCreateSignupCodeRequest,
    ): Promise<CreateSignupCodeResponse> =>
      audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.createCode,
          detail: { label: input.label, maxUses: input.maxUses, days: input.days },
          ip: ctx.ip,
        },
        () =>
          signupCodes.operatorCreate({
            label: input.label,
            maxUses: input.maxUses,
            ttlMs: input.days * DAY_MS,
          }),
      ),

    extendSignupCode: async (ctx: AdminContext, codeId: string, days: number): Promise<void> => {
      await audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.extendCode,
          detail: { codeId, days },
          ip: ctx.ip,
        },
        async () => {
          if (!(await repo.extendSignupCode(codeId, days * DAY_MS, gameNow()))) {
            throw new AppError('NOT_FOUND', MESSAGES.notFoundCode);
          }
        },
      );
    },

    revokeSignupCode: async (ctx: AdminContext, codeId: string): Promise<void> => {
      await audited(
        {
          actorUserId: ctx.admin.id,
          action: AUDIT_ACTIONS.revokeCode,
          detail: { codeId },
          ip: ctx.ip,
        },
        async () => {
          if (!(await signupCodes.operatorRevoke(codeId))) {
            throw new AppError('NOT_FOUND', MESSAGES.notRevoked);
          }
        },
      );
    },

    // --- Audit log ---------------------------------------------------------

    audit: async (query: AdminListQuery): Promise<AdminAuditResponse> => {
      const { page, offset } = pageOf(query);
      const { rows, total } = await repo.listAudit(query.q || undefined, ADMIN_PAGE_SIZE, offset);
      return {
        entries: rows.map((r) => ({
          id: r.id,
          at: iso(r.createdAt),
          actor: r.actor,
          action: r.action,
          targetUser: r.targetUser,
          targetMap: r.targetMap,
          detail: z.record(z.string(), z.unknown()).catch({}).parse(r.detail),
          outcome: r.outcome,
        })),
        page,
        pageSize: ADMIN_PAGE_SIZE,
        total,
      };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
