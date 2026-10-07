import type {
  AccountHelpersResponse,
  HelperCandidatesResponse,
  MemberPasswordResetResponse,
  PublicUser,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createAuthRepo } from '../auth/repo.js';
import { newResetCredentials } from '../auth/secrets.js';
import { HELPER_RULES, latestHelperBirthYear } from './limits.js';
import { createAccountHelpersRepo, type AccountHelpersRepo } from './repo.js';

/**
 * Grown-up helpers (#197, owner decisions 2026-10-07). A player picks a helper
 * from their candidate list and the helper says yes. Only then can the helper
 * see the player's name and reset their password, like a patch owner's reset
 * (decision D): every session revoked, a one-time password and a new recovery
 * code. Either side can end it.
 */
export interface AccountHelpersService {
  /** Both sides of the player's links. */
  mine: (user: PublicUser) => Promise<AccountHelpersResponse>;
  /** Who the player may ask. */
  candidates: (user: PublicUser) => Promise<HelperCandidatesResponse>;
  /** Asks someone from the candidate list. */
  ask: (user: PublicUser, helperId: string) => Promise<AccountHelpersResponse>;
  /** Ends a helper link, or takes back an ask, from the player's side. */
  removeHelper: (user: PublicUser, helperId: string) => Promise<AccountHelpersResponse>;
  /** The helper says yes to a player's ask. */
  accept: (helper: PublicUser, playerId: string) => Promise<AccountHelpersResponse>;
  /** The helper says no. The player just sees the ask go away. */
  decline: (helper: PublicUser, playerId: string) => Promise<AccountHelpersResponse>;
  /** The helper stops helping. */
  stopHelping: (helper: PublicUser, playerId: string) => Promise<AccountHelpersResponse>;
  /** A linked helper resets the player's password; capped per day and recorded. */
  resetPassword: (helper: PublicUser, playerId: string) => Promise<MemberPasswordResetResponse>;
}

export interface AccountHelpersServiceOptions {
  db: Executor;
  clock?: Clock;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notOnList: 'You can only ask someone from your list.',
  alreadyAsked: 'You already asked them!',
  tooManyHelpers: `You have ${String(HELPER_RULES.helpersPerPlayer)} helpers already. Remove one to ask someone new.`,
  helperFull: "They're helping lots of players already. Try someone else!",
  askGone: "That ask isn't there any more.",
  notYourHelper: "They aren't your helper any more.",
  notHelping: "You aren't helping them any more.",
  notLinked: 'You can only help players who picked you as their helper.',
  grownUpsOnly: 'Helpers are grown-ups. Ask a grown-up in your patch to join!',
  resetsUsedUp: `That's ${String(HELPER_RULES.resetsPerDay)} resets today. Try again tomorrow!`,
} as const;

export function createAccountHelpersService(
  options: AccountHelpersServiceOptions,
): AccountHelpersService {
  const store = createAccountHelpersRepo(options.db);
  const now = options.clock ?? (() => new Date());

  /** Born in this year or earlier: old enough to help (owner decision 2026-10-07). */
  const bornBy = () => latestHelperBirthYear(now().getUTCFullYear());
  /** Throws unless the account is a grown-up. */
  const assertGrownUp = async (repo: AccountHelpersRepo, userId: string) => {
    const year = await repo.birthYear(userId);
    if (year === null || year > bornBy()) throw new AppError('FORBIDDEN', MESSAGES.grownUpsOnly);
  };

  const view = async (repo: AccountHelpersRepo, userId: string) => {
    const links = await repo.liveLinks(userId);
    return {
      helpers: links.helpers,
      canAddHelper: links.helpers.length < HELPER_RULES.helpersPerPlayer,
      asks: links.asks,
      helping: links.helping,
    };
  };

  /** One status change, then the player's fresh view. */
  const move = async (
    userId: string,
    helperUserId: string,
    from: readonly ('pending' | 'active')[],
    to: 'active' | 'declined' | 'removed',
    viewer: string,
    missing: string,
  ) => {
    const moved = await store.moveLive({ userId, helperUserId, from, to, now: now() });
    if (!moved) throw new AppError('NOT_FOUND', missing);
    return view(store, viewer);
  };

  return {
    mine: (user) => view(store, user.id),

    candidates: async (user) => ({ candidates: await store.candidates(user.id, bornBy()) }),

    ask: async (user, helperId) => {
      try {
        await store.transaction(async (repo) => {
          // Both accounts, so neither side's cap can be passed by two asks at once.
          await repo.lockUsers([user.id, helperId]);
          const candidates = await repo.candidates(user.id, bornBy());
          if (!candidates.some((c) => c.user.id === helperId)) {
            // Already asked shows up as "not on the list" too; say which.
            if (await repo.findLive(user.id, helperId)) {
              throw new AppError('CONFLICT', MESSAGES.alreadyAsked);
            }
            throw new AppError('NOT_FOUND', MESSAGES.notOnList);
          }
          if ((await repo.countLive({ userId: user.id })) >= HELPER_RULES.helpersPerPlayer) {
            throw new AppError('CONFLICT', MESSAGES.tooManyHelpers);
          }
          if ((await repo.countLive({ helperUserId: helperId })) >= HELPER_RULES.playersPerHelper) {
            throw new AppError('CONFLICT', MESSAGES.helperFull);
          }
          await repo.insertAsk(user.id, helperId, now());
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.alreadyAsked);
        throw err;
      }
      return view(store, user.id);
    },

    removeHelper: (user, helperId) =>
      move(user.id, helperId, ['pending', 'active'], 'removed', user.id, MESSAGES.notYourHelper),

    accept: async (helper, playerId) => {
      // Asks are only offered to grown-ups, but birth years can't be trusted
      // to stay put, so saying yes checks again.
      await assertGrownUp(store, helper.id);
      return move(playerId, helper.id, ['pending'], 'active', helper.id, MESSAGES.askGone);
    },

    decline: (helper, playerId) =>
      move(playerId, helper.id, ['pending'], 'declined', helper.id, MESSAGES.askGone),

    stopHelping: (helper, playerId) =>
      move(playerId, helper.id, ['active'], 'removed', helper.id, MESSAGES.notHelping),

    resetPassword: async (helper, playerId) => {
      // Hash before taking any locks; Argon2 is slow on purpose.
      const credentials = await newResetCredentials();
      const at = now();
      const player = await store.transaction(async (repo, tx) => {
        // Both accounts (tech spec §7, step 4): the player's holds off a second
        // reset, a recover and a new code; the helper's makes the daily count
        // below exact. The password reset then takes `recovery_codes`.
        await repo.lockUsers([helper.id, playerId]);
        // Then the link, so a removal waits for this reset or wins before it.
        if (!(await repo.lockActive(playerId, helper.id))) {
          throw new AppError('FORBIDDEN', MESSAGES.notLinked);
        }
        // Only a grown-up resets, checked again here (owner decision 2026-10-07).
        await assertGrownUp(repo, helper.id);
        const since = new Date(at.getTime() - HELPER_RULES.resetWindowMs);
        if ((await repo.countResetsSince(helper.id, since)) >= HELPER_RULES.resetsPerDay) {
          throw new AppError('RATE_LIMITED', MESSAGES.resetsUsedUp);
        }
        const target = await repo.findUser(playerId);
        if (!target) throw new AppError('NOT_FOUND', MESSAGES.notLinked);
        // Revokes their sessions and rotates their recovery code (auth contract).
        await createAuthRepo(tx).resetPassword({
          userId: playerId,
          passwordHash: credentials.passwordHash,
          newRecoveryCodeHash: credentials.newRecoveryCodeHash,
          now: at,
        });
        await repo.insertReset({ userId: playerId, helperUserId: helper.id, now: at });
        return target;
      });
      return {
        user: player,
        temporaryPassword: credentials.temporaryPassword,
        recoveryCode: credentials.recoveryCode,
      };
    },
  };
}
