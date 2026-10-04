import { COIN_RULES, type CoinSource, type Coins, type PublicUser } from '@heartpatch/shared';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createCoinsRepo } from './repo.js';

/*
 * Patch Coins (design doc §23; issue #45). Earned in play, never bought
 * (CLAUDE.md rule 9), and the account's, not a patch's (DECISIONS F). Every
 * change is a `coin_ledger` row plus the cached `coin_balances` row, in the
 * caller's transaction (rule 7). `(source, ref_id)` is unique, so a battle,
 * capture, care action or milestone pays exactly once. Battle and capture
 * coins have a daily cap per account day (`COIN_RULES.dailyCaps`); care's
 * coins come capped already (`care_log.coins`, decision G).
 */

/** Kid-readable (style guide §6). */
export const COIN_MESSAGES = {
  notEnough: 'Not enough Patch Coins yet! Keep playing to earn more.',
} as const;

/** Daily caps by source; sources not listed have none here. */
const DAILY_CAPS: Partial<Record<CoinSource, number>> = COIN_RULES.dailyCaps;

/** One credit: who, how much, and the source event it's for. */
export interface CoinCredit {
  /** `battle`, `capture`, `care`, `milestone` (#44) or `dev-grant`. */
  source: Exclude<CoinSource, 'boutique'>;
  /** The battle, care action or milestone it's for: each pays once, ever. */
  refId: string;
  userId: string;
  /** The patch it was earned on; leave it out (or null) for account-level ones like milestones. */
  mapId?: string | null;
  /** Coins before the daily cap; 0 or less credits nothing. */
  amount: number;
  at: Date;
}

/** What a credit did. */
export interface CoinCreditResult {
  /** Coins actually credited: 0 if already paid, capped, or nothing to pay. */
  credited: number;
  /** The balance afterwards, or null if nothing was locked (nothing to pay). */
  balance: number | null;
}

/** The account's IANA time zone (`users.time_zone`), or UTC if there's no such user. */
export async function accountTimeZone(db: Executor, userId: string): Promise<string> {
  return (await createCoinsRepo(db).timeZoneOf(userId)) ?? 'UTC';
}

/**
 * The account's local date at `at` (`YYYY-MM-DD` in `users.time_zone`): the
 * day that daily caps (coins, care) and the Boutique's racks go by.
 */
export async function accountDay(db: Executor, userId: string, at: Date): Promise<string> {
  return localDate(at, await accountTimeZone(db, userId));
}

/**
 * Pays Patch Coins inside the caller's transaction (battles, captures and
 * care call it; #44's milestones will too). Exactly once per `(source,
 * refId)`, and battle and capture coins stop at the account's daily cap.
 * Lock order (tech spec §7): takes the account's balance row, so call it
 * after your squishy, inventory and `species_seen` locks and before your
 * events (`maps`). Writes no game event.
 */
export async function creditCoins(tx: Executor, credit: CoinCredit): Promise<CoinCreditResult> {
  if (credit.amount <= 0) return { credited: 0, balance: null };
  const repo = createCoinsRepo(tx);
  // The balance lock first: retries and parallel credits wait here, one at a time.
  const balance = await repo.lockBalance(credit.userId);
  if (await repo.hasChange(credit.source, credit.refId)) return { credited: 0, balance };
  const day = await accountDay(tx, credit.userId, credit.at);
  const cap = DAILY_CAPS[credit.source];
  const room =
    cap === undefined
      ? credit.amount
      : cap - (await repo.earnedOn(credit.userId, credit.source, day));
  const amount = Math.min(credit.amount, room);
  if (amount <= 0) return { credited: 0, balance };
  const after = await repo.apply({ ...credit, mapId: credit.mapId ?? null, amount, day });
  return { credited: amount, balance: after };
}

/**
 * Spends Patch Coins inside the caller's transaction (the Boutique), under
 * the balance row lock: `CONFLICT` with nothing changed if the account has
 * too few. Returns the balance afterwards.
 */
export async function spendCoins(
  tx: Executor,
  spend: { userId: string; refId: string; amount: number; at: Date },
): Promise<number> {
  const repo = createCoinsRepo(tx);
  const balance = await repo.lockBalance(spend.userId);
  if (balance < spend.amount) throw new AppError('CONFLICT', COIN_MESSAGES.notEnough);
  return repo.apply({
    userId: spend.userId,
    source: 'boutique',
    refId: spend.refId,
    amount: -spend.amount,
    mapId: null,
    day: await accountDay(tx, spend.userId, spend.at),
    at: spend.at,
  });
}

export interface CoinsService {
  get: (user: PublicUser) => Promise<Coins>;
  /** Dev/test only: hands the player coins (`dev-grant`), past every cap. */
  devGrant: (user: PublicUser, amount: number) => Promise<Coins>;
}

export interface CoinsServiceOptions {
  db: Executor;
  clock?: Clock;
}

export function createCoinsService(options: CoinsServiceOptions): CoinsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createCoinsRepo(db);
  return {
    get: async (user) => ({ balance: await store.balance(user.id) }),
    devGrant: async (user, amount) =>
      store.transaction(async (_repo, tx) => {
        const { balance } = await creditCoins(tx, {
          source: 'dev-grant',
          refId: uuidv7(),
          userId: user.id,
          mapId: null,
          amount,
          at: now(),
        });
        return { balance: balance ?? 0 };
      }),
  };
}
