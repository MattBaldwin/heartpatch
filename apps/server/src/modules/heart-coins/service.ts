import {
  HEART_COIN_RULES,
  type HeartCoinCappedSource,
  type HeartCoins,
  type HeartCoinSource,
  type PublicUser,
} from '@heartpatch/shared';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDate, nextLocalMidnight, type Clock } from '../../lib/time.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createHeartCoinsRepo } from './repo.js';

/*
 * Heart Coins (#601): a second currency, per player per patch. Earned by
 * playing on a patch, spent only there, never traded, never for clothes
 * (Patch Coins stay the account's, DECISIONS F). Every change is a
 * `heart_coin_ledger` row plus the cached `heart_coin_balances` row, in the
 * caller's transaction (rule 7). `(source, ref_id)` is unique, so a battle,
 * capture, care action, sale or morning's upkeep changes it exactly once.
 * Earning is capped per patch day, in the patch's time zone. The Tutorial
 * Glade pays none: there's nothing to spend them on there.
 */

/** Kid-readable (style guide §6). */
export const HEART_COIN_MESSAGES = {
  notEnough: 'Not enough Heart Coins yet! Play on your patch to earn more.',
} as const;

/** Daily caps by source; sources not listed have none. */
const DAILY_CAPS: Partial<Record<HeartCoinSource, number>> = HEART_COIN_RULES.dailyCaps;

/** One credit: who, where, how much, and the source event it's for. */
export interface HeartCoinCredit {
  /** `battle`, `capture`, `care`, `sell` (#601 PR 3) or `dev-grant`. */
  source: Exclude<HeartCoinSource, 'upkeep'>;
  /** The battle, care action or sale it's for: each pays once, ever. */
  refId: string;
  mapId: string;
  userId: string;
  /** Coins before the daily cap; 0 or less credits nothing. */
  amount: number;
  at: Date;
}

/** What a credit did. */
export interface HeartCoinCreditResult {
  /** Coins actually credited: 0 if already paid, capped, on the Glade, or nothing to pay. */
  credited: number;
  /** The balance afterwards, or null if nothing was locked. */
  balance: number | null;
}

/** One spend: building upkeep for now (#601 PR 6). */
export interface HeartCoinSpend {
  source: Extract<HeartCoinSource, 'upkeep'>;
  /** The building's morning it's for: each is charged once, ever. */
  refId: string;
  mapId: string;
  userId: string;
  /** Coins to take; more than 0. */
  amount: number;
  at: Date;
}

/** The patch day at `at` (`YYYY-MM-DD` in `maps.time_zone`), and the map's kind. */
async function patchDay(tx: Executor, mapId: string, at: Date) {
  const map = await createMapsRepo(tx).findMap(mapId);
  if (!map) return null;
  return { day: localDate(at, map.timeZone), kind: map.kind };
}

/**
 * Pays Heart Coins inside the caller's transaction (battles and care call
 * it; selling will). Exactly once per `(source, refId)`, and each capped
 * source stops at the player's cap for the patch day. Nothing on the
 * Tutorial Glade. Lock order (tech spec §7 step 12b): takes the player's
 * balance row on the patch, so call it after any `coin_balances` lock
 * (`creditCoins`) and before your events (`maps`). Writes no game event.
 */
export async function creditHeartCoins(
  tx: Executor,
  credit: HeartCoinCredit,
): Promise<HeartCoinCreditResult> {
  if (credit.amount <= 0) return { credited: 0, balance: null };
  const patch = await patchDay(tx, credit.mapId, credit.at);
  if (!patch || patch.kind === 'tutorial') return { credited: 0, balance: null };
  const repo = createHeartCoinsRepo(tx);
  // The balance lock first: retries and parallel credits wait here, one at a time.
  const balance = await repo.lockBalance(credit.mapId, credit.userId);
  if (await repo.hasChange(credit.source, credit.refId)) return { credited: 0, balance };
  const cap = DAILY_CAPS[credit.source];
  const room =
    cap === undefined
      ? credit.amount
      : cap - ((await repo.earnedOn(credit.mapId, credit.userId, patch.day))[credit.source] ?? 0);
  const amount = Math.min(credit.amount, room);
  if (amount <= 0) return { credited: 0, balance };
  const after = await repo.apply({ ...credit, amount, day: patch.day });
  return { credited: amount, balance: after };
}

/**
 * Spends Heart Coins inside the caller's transaction, under the balance
 * row lock: null with nothing changed if the player has too few on the
 * patch. Once per `(source, refId)`: a repeat changes nothing and returns
 * the balance. For upkeep, which pauses a building instead of failing
 * (#601 PR 6). Lock order as `creditHeartCoins`.
 */
export async function trySpendHeartCoins(
  tx: Executor,
  spend: HeartCoinSpend,
): Promise<number | null> {
  if (spend.amount <= 0) throw new Error(`trySpendHeartCoins: amount ${String(spend.amount)}`);
  const patch = await patchDay(tx, spend.mapId, spend.at);
  if (!patch) throw new Error(`trySpendHeartCoins: no map ${spend.mapId}`);
  const repo = createHeartCoinsRepo(tx);
  const balance = await repo.lockBalance(spend.mapId, spend.userId);
  if (await repo.hasChange(spend.source, spend.refId)) return balance;
  if (balance < spend.amount) return null;
  return repo.apply({ ...spend, amount: -spend.amount, day: patch.day });
}

/** `trySpendHeartCoins`, but `CONFLICT` (nothing changed) if the player has too few. */
export async function spendHeartCoins(tx: Executor, spend: HeartCoinSpend): Promise<number> {
  const after = await trySpendHeartCoins(tx, spend);
  if (after === null) throw new AppError('CONFLICT', HEART_COIN_MESSAGES.notEnough);
  return after;
}

/** One number per capped source. */
const bySource = (
  pick: (source: HeartCoinCappedSource) => number,
): Record<HeartCoinCappedSource, number> => ({
  battle: pick('battle'),
  capture: pick('capture'),
  care: pick('care'),
  sell: pick('sell'),
});

/** My Heart Coins on a patch at `at`: the balance, today's earnings and caps, and the reset. */
export async function heartCoinsView(
  tx: Executor,
  map: { id: string; timeZone: string },
  userId: string,
  at: Date,
): Promise<HeartCoins> {
  const repo = createHeartCoinsRepo(tx);
  const day = localDate(at, map.timeZone);
  const [balance, earned] = await Promise.all([
    repo.balance(map.id, userId),
    repo.earnedOn(map.id, userId, day),
  ]);
  return {
    balance,
    today: bySource((s) => Math.max(0, earned[s] ?? 0)),
    caps: bySource((s) => HEART_COIN_RULES.dailyCaps[s]),
    resetsAt: nextLocalMidnight(at, map.timeZone).toISOString(),
  };
}

export interface HeartCoinsService {
  get: (user: PublicUser, mapId: string) => Promise<HeartCoins>;
  /** Dev/test only: hands the player Heart Coins on the patch (`dev-grant`), past every cap. */
  devGrant: (user: PublicUser, mapId: string, amount: number) => Promise<HeartCoins>;
}

export interface HeartCoinsServiceOptions {
  db: Executor;
  clock?: Clock;
}

export function createHeartCoinsService(options: HeartCoinsServiceOptions): HeartCoinsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createHeartCoinsRepo(db);
  return {
    get: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      return heartCoinsView(db, map, user.id, now());
    },
    devGrant: async (user, mapId, amount) =>
      store.transaction(async (_repo, tx) => {
        const { map } = await requireMember(tx, user, mapId);
        const at = now();
        await creditHeartCoins(tx, {
          source: 'dev-grant',
          refId: uuidv7(),
          mapId,
          userId: user.id,
          amount,
          at,
        });
        return heartCoinsView(tx, map, user.id, at);
      }),
  };
}
