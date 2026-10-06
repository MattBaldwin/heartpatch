import { createHash, randomInt } from 'node:crypto';
import {
  formatSignupCode,
  normalizeSignupCode,
  SIGNUP_CODE_ALPHABET,
  SIGNUP_CODE_LENGTH,
  signupCodeShape,
  type CreateSignupCodeResponse,
  type MySignupCodesResponse,
  type PublicUser,
  type SignupCodeStatus,
  type SignupCodeSummary,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import type { Clock } from '../../lib/time.js';
import { safeEqual } from '../auth/secrets.js';
import { createMapsRepo, type InviteRow } from '../maps/repo.js';
import { SIGNUP_CODE_RULES } from './limits.js';
import { createSignupCodesRepo, type SignupCodeRow } from './repo.js';

/**
 * A code that passed the sign-up check: the operator's `HP_SIGNUP_CODE`
 * (bootstrap, decision 3 of #195), a family code, or a patch invite (one code
 * makes the account and asks to join).
 */
export type SignupPass =
  { kind: 'bootstrap' } | { kind: 'family'; codeHash: string } | { kind: 'invite'; code: string };

/** Who brought a new account in (`users.signup_code_id`, `users.invited_by`). */
export interface Attribution {
  signupCodeId: string | null;
  invitedBy: string | null;
}

export interface SignupPasses {
  /** Checks a typed code before anything else is looked at; throws a kid-readable error. */
  check: (code: string) => Promise<SignupPass>;
  /**
   * Spends the pass inside the new account's transaction: one use of a family
   * code, or a join request on the invite's patch. Throws (rolling the account
   * back) if the code stopped working since `check`.
   */
  redeem: (tx: Executor, pass: SignupPass, userId: string) => Promise<Attribution>;
}

export interface SignupCodesService extends SignupPasses {
  /** A patch owner's codes. */
  mine: (user: PublicUser) => Promise<MySignupCodesResponse>;
  /** A patch owner makes a code (capped). The code is shown this once. */
  create: (user: PublicUser, label: string) => Promise<CreateSignupCodeResponse>;
  /** A patch owner turns one of their codes off. Already off is fine. */
  revoke: (user: PublicUser, codeId: string) => Promise<void>;

  // Operator only (`ops/signup-code.ts`), never over HTTP.
  operatorCreate: (input: {
    label: string;
    maxUses?: number;
    ttlMs?: number;
  }) => Promise<CreateSignupCodeResponse>;
  /** Every code, with its maker's username (null for the operator's own). */
  operatorList: () => Promise<(SignupCodeSummary & { createdBy: string | null })[]>;
  /** False if there's no such code or it was already off. */
  operatorRevoke: (codeId: string) => Promise<boolean>;
}

export interface SignupCodesServiceOptions {
  db: Executor;
  /** `HP_SIGNUP_CODE`: still works for one release after #195. */
  bootstrapCode: string | undefined;
  clock?: Clock;
}

// Kid-readable messages (style guide §6). Codes are told apart only after
// they're found, so a guess learns nothing it couldn't from "doesn't work".
const MESSAGES = {
  badCode: "Hmm, that code doesn't work. Check it with a grown-up!",
  expired: 'That code is too old now. Ask a grown-up for a new one!',
  usedUp: 'That code is all used up! Ask a grown-up for a new one.',
  revoked: 'That code was turned off. Ask a grown-up for a new one!',
  patchFull: 'That patch is full! Ask a grown-up for a family code instead.',
  ownerFirst: 'Make a patch first, then you can make family codes!',
  atCap: `You have ${String(SIGNUP_CODE_RULES.ownerLiveMax)} family codes. Turn one off to make another!`,
  notFound: "We couldn't find that code.",
} as const;

/** How many times to retry on the (very unlikely) chance a new code is taken. */
const CODE_ATTEMPTS = 3;

function newSignupCode(): string {
  return Array.from({ length: SIGNUP_CODE_LENGTH }, () =>
    SIGNUP_CODE_ALPHABET.charAt(randomInt(SIGNUP_CODE_ALPHABET.length)),
  ).join('');
}

/**
 * SHA-256 of the normalized code. A fast hash so sign-up can look the code up
 * by it (there's no username to find the row by, as recovery codes have).
 * 12 characters are ~59 random bits, codes last 14 days, and guesses over HTTP
 * are rate-limited, so the hash only has to keep the code unreadable at rest.
 */
export function hashSignupCode(code: string): string {
  return createHash('sha256').update(normalizeSignupCode(code)).digest('hex');
}

function statusOf(row: SignupCodeRow, now: Date): SignupCodeStatus {
  if (row.revokedAt !== null) return 'revoked';
  if (row.useCount >= row.maxUses) return 'used_up';
  if (row.expiresAt <= now) return 'expired';
  return 'live';
}

function inviteProblem(invite: InviteRow | null, now: Date): string | null {
  if (!invite) return MESSAGES.badCode;
  if (invite.revokedAt !== null) return MESSAGES.revoked;
  if (invite.expiresAt <= now) return MESSAGES.expired;
  return null;
}

const STATUS_MESSAGES: Record<Exclude<SignupCodeStatus, 'live'>, string> = {
  revoked: MESSAGES.revoked,
  used_up: MESSAGES.usedUp,
  expired: MESSAGES.expired,
};

export function createSignupCodesService(options: SignupCodesServiceOptions): SignupCodesService {
  const { db, bootstrapCode } = options;
  const now = options.clock ?? (() => new Date());
  const store = createSignupCodesRepo(db);

  const summaries = async (rows: readonly SignupCodeRow[]): Promise<SignupCodeSummary[]> => {
    const usedBy = await store.usedBy(rows.map((r) => r.id));
    const at = now();
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      status: statusOf(row, at),
      uses: row.useCount,
      maxUses: row.maxUses,
      expiresAt: row.expiresAt.toISOString(),
      usedBy: usedBy.get(row.id) ?? [],
    }));
  };

  /** Draws a code, retrying if its hash is taken; returns it with its new row. */
  const insertFresh = async (
    insert: (codeHash: string) => Promise<SignupCodeRow>,
  ): Promise<CreateSignupCodeResponse> => {
    for (let attempt = 1; ; attempt++) {
      const code = newSignupCode();
      try {
        const row = await insert(hashSignupCode(code));
        const [summary] = await summaries([row]);
        if (!summary) throw new Error('signup code summary missing');
        return { code: formatSignupCode(code), signupCode: summary };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
      }
    }
  };

  const familyProblem = (row: SignupCodeRow | null, at: Date): string | null => {
    if (!row) return MESSAGES.badCode;
    const status = statusOf(row, at);
    return status === 'live' ? null : STATUS_MESSAGES[status];
  };

  return {
    check: async (input) => {
      // Always compared (constant time), so timing doesn't say whether one is set.
      const isBootstrap = safeEqual(input.trim(), bootstrapCode ?? '');
      if (bootstrapCode !== undefined && isBootstrap) return { kind: 'bootstrap' };
      const at = now();
      switch (signupCodeShape(input)) {
        case 'family': {
          const codeHash = hashSignupCode(input);
          const problem = familyProblem(await store.findByHash(codeHash), at);
          if (problem) throw new AppError('FORBIDDEN', problem);
          return { kind: 'family', codeHash };
        }
        case 'invite': {
          const code = normalizeSignupCode(input);
          const maps = createMapsRepo(db);
          const invite = await maps.findInviteByCode(code);
          const problem = inviteProblem(invite, at);
          if (problem || !invite) throw new AppError('FORBIDDEN', problem ?? MESSAGES.badCode);
          // A courtesy check so nobody makes an account to wait on a full
          // patch; the transaction checks again, and approval under lock.
          const map = await maps.findMap(invite.mapId);
          if (map && (await maps.activeHomeSlots(invite.mapId)).count >= map.maxPlayers) {
            throw new AppError('CONFLICT', MESSAGES.patchFull);
          }
          return { kind: 'invite', code };
        }
        case 'other':
          throw new AppError('FORBIDDEN', MESSAGES.badCode);
      }
    },

    redeem: async (tx, pass, userId) => {
      const at = now();
      const repo = createSignupCodesRepo(tx);
      let attribution: Attribution;
      switch (pass.kind) {
        case 'bootstrap':
          return { signupCodeId: null, invitedBy: null };
        case 'family': {
          const spent = await repo.spend(pass.codeHash, at);
          if (!spent) {
            // Someone else's sign-up took the last use (or it was turned off) meanwhile.
            const problem = familyProblem(await repo.findByHash(pass.codeHash), at);
            throw new AppError('FORBIDDEN', problem ?? MESSAGES.badCode);
          }
          attribution = { signupCodeId: spent.id, invitedBy: spent.createdByUserId };
          break;
        }
        case 'invite': {
          const maps = createMapsRepo(tx);
          const invite = await maps.findInviteByCode(pass.code);
          const problem = inviteProblem(invite, at);
          if (problem || !invite) throw new AppError('FORBIDDEN', problem ?? MESSAGES.badCode);
          const map = await maps.findMap(invite.mapId);
          if (!map) throw new Error(`redeem: invite ${invite.id} has no map`);
          if ((await maps.activeHomeSlots(invite.mapId)).count >= map.maxPlayers) {
            throw new AppError('CONFLICT', MESSAGES.patchFull);
          }
          await maps.insertJoinRequest({ mapId: invite.mapId, userId, inviteCodeId: invite.id });
          attribution = { signupCodeId: null, invitedBy: invite.createdByUserId };
          break;
        }
      }
      await repo.setAttribution(userId, attribution);
      return attribution;
    },

    mine: async (user) => {
      const at = now();
      const rows = await store.list(
        user.id,
        at,
        new Date(at.getTime() - SIGNUP_CODE_RULES.listedForMs),
        SIGNUP_CODE_RULES.listMax,
      );
      return { codes: await summaries(rows), liveMax: SIGNUP_CODE_RULES.ownerLiveMax };
    },

    create: async (user, label) => {
      assertAllowedText(label, 'name');
      return insertFresh((codeHash) =>
        store.transaction(async (repo, tx) => {
          // Locking the account makes two taps count one at a time against the cap.
          await createMapsRepo(tx).lockUser(user.id);
          if (!(await repo.ownsPatch(user.id))) {
            throw new AppError('FORBIDDEN', MESSAGES.ownerFirst);
          }
          const at = now();
          if ((await repo.countLive(user.id, at)) >= SIGNUP_CODE_RULES.ownerLiveMax) {
            throw new AppError('CONFLICT', MESSAGES.atCap);
          }
          return repo.insert({
            codeHash,
            label,
            createdByUserId: user.id,
            maxUses: SIGNUP_CODE_RULES.defaultMaxUses,
            expiresAt: new Date(at.getTime() + SIGNUP_CODE_RULES.ttlMs),
          });
        }),
      );
    },

    revoke: async (user, codeId) => {
      const row = await store.find(codeId);
      // The same words whether it's missing or someone else's.
      if (row?.createdByUserId !== user.id) throw new AppError('NOT_FOUND', MESSAGES.notFound);
      await store.revoke(codeId, user.id, now());
    },

    operatorCreate: async (input) => {
      const at = now();
      return insertFresh((codeHash) =>
        store.insert({
          codeHash,
          label: input.label,
          createdByUserId: null,
          maxUses: input.maxUses ?? SIGNUP_CODE_RULES.defaultMaxUses,
          expiresAt: new Date(at.getTime() + (input.ttlMs ?? SIGNUP_CODE_RULES.ttlMs)),
        }),
      );
    },

    operatorList: async () => {
      const at = now();
      const rows = await store.list(
        undefined,
        at,
        new Date(at.getTime() - SIGNUP_CODE_RULES.listedForMs),
        SIGNUP_CODE_RULES.operatorListMax,
      );
      const makers = await store.usernames(
        rows.flatMap((r) => (r.createdByUserId === null ? [] : [r.createdByUserId])),
      );
      return (await summaries(rows)).map((summary, i) => {
        const makerId = rows[i]?.createdByUserId ?? null;
        return { ...summary, createdBy: makerId === null ? null : (makers.get(makerId) ?? null) };
      });
    },

    operatorRevoke: (codeId) => store.revoke(codeId, undefined, now()),
  };
}
