import {
  GLIMMER_SWAP,
  type GlimmerSwapRequest,
  type GlimmerSwapRules,
  type GlimmerSwapView,
  type ItemCounts,
  type PublicUser,
} from '@heartpatch/shared';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDayStart, nextLocalMidnight, type Clock } from '../../lib/time.js';
import { accountTimeZone } from '../coins/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { requirePostAccess } from '../journeys/service.js';
import { requireMember } from '../maps/members.js';
import { createGlimmerSwapRepo, SWAP_REASON } from './repo.js';

/*
 * The trading post's Glimmer swap (#523; owner decision 2026-10-18, the
 * owner-approved mockup): a few of one everyday resource for Glimmer, at a
 * post the player can use (connected, or a journey's visit pass, #270), a few
 * a day. The rate, the resources and the cap are shared data (`GLIMMER_SWAP`).
 * Server-authoritative and atomic (CLAUDE.md rules 1 and 7): one transaction
 * under the account's `users` lock, so two taps (or two patches) can't pass
 * the cap. The day is the account's own (its time zone, like the Boutique),
 * and its count is the account's `post-swap` Glimmer ledger rows: no table
 * of its own. Works with trading off: nobody else is involved. It writes no
 * game event: nobody else sees a swap, and the bag's reply shows it.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notTaken: "The post doesn't take that one. Try Timber, Stone, Greens, Water or Ice!",
  capped: "That's all the Glimmer for today! Come back tomorrow. 🌙",
} as const;

export interface GlimmerSwapService {
  /** Today's swaps (the account's day) and my bag's accepted resources and Glimmer on this patch. */
  view: (user: PublicUser, mapId: string) => Promise<GlimmerSwapView>;
  /** One swap of `itemId` at the post at (q, r). */
  swap: (user: PublicUser, mapId: string, request: GlimmerSwapRequest) => Promise<GlimmerSwapView>;
}

export interface GlimmerSwapServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests pass other rules; the game uses `GLIMMER_SWAP`. */
  rules?: GlimmerSwapRules;
}

export function createGlimmerSwapService(options: GlimmerSwapServiceOptions): GlimmerSwapService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? GLIMMER_SWAP;
  const shown = new Set([...rules.accepts, 'glimmer']);

  /** What the tab shows at `at`, read through `exec` (inside or outside a transaction). */
  async function viewOf(
    exec: Executor,
    userId: string,
    mapId: string,
    at: Date,
  ): Promise<GlimmerSwapView> {
    const timeZone = await accountTimeZone(exec, userId);
    const resetsAt = nextLocalMidnight(at, timeZone);
    const [swappedToday, bag] = await Promise.all([
      createGlimmerSwapRepo(exec).swappedBetween(userId, localDayStart(at, timeZone), resetsAt),
      createInventoryRepo(exec).list({ mapId, userId }),
    ]);
    const have: ItemCounts = {};
    for (const id of shown) have[id] = bag[id] ?? 0;
    return { swappedToday, resetsAt: resetsAt.toISOString(), have };
  }

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId);
      return viewOf(db, user.id, mapId, now());
    },

    swap: async (user, mapId, request) => {
      const { itemId } = request;
      if (!rules.accepts.includes(itemId))
        throw new AppError('VALIDATION_FAILED', MESSAGES.notTaken);
      await requireMember(db, user, mapId);
      return createGlimmerSwapRepo(db).transaction(async (repo, tx) => {
        const at = now();
        const owner = { mapId, userId: user.id };
        await requireMember(tx, user, mapId);
        // 1. At a post I can use: connected, or a visit pass (#270).
        await requirePostAccess(tx, { mapId, userId: user.id, post: request, at });
        // 2. The account's `users` row (tech spec §7 step 4): one swap at a
        // time per account, on every patch, so the cap is checked under it.
        await repo.lockAccount(user.id);
        // 3. Today's swaps, by the account's own day (read after the lock, so
        // a swap that waited past midnight counts on the new day).
        const timeZone = await accountTimeZone(tx, user.id);
        const swapped = await repo.swappedBetween(
          user.id,
          localDayStart(at, timeZone),
          nextLocalMidnight(at, timeZone),
        );
        if (swapped + rules.get > rules.dailyCap) throw new AppError('CONFLICT', MESSAGES.capped);
        // 4. Both bag rows in item-id order (step 11), then the resources
        // (CONFLICT, nothing changed, if short) and the Glimmer, ledgered
        // together against this swap at the service's clock.
        const swapId = uuidv7();
        await lockGrantRows(tx, mapId, [
          { userId: user.id, items: { [itemId]: rules.give, glimmer: rules.get } },
        ]);
        await consumeItems(tx, owner, { [itemId]: rules.give }, SWAP_REASON, swapId, at);
        await grantItems(tx, owner, { glimmer: rules.get }, SWAP_REASON, swapId, at);
        return viewOf(tx, user.id, mapId, at);
      });
    },
  };
}
