import type { HeartCoins, HeartCoinsBySource } from '@heartpatch/shared';

// Heart Coins (#601): what the sheet shows, worked out from the server's
// reply. Pure, so the numbers and words are tested without a DOM. The server
// pays and caps everything (CLAUDE.md rule 1); this only reads it.

/** Kid-readable (style guide §6). Heart Coins stay on their patch; Patch Coins go everywhere. */
export const HEART_COINS_TEXT = {
  title: 'Heart Coins',
  /** "12 Heart Coins", for screen readers; the pill itself shows the number. */
  label: (n: number) => `${String(n)} Heart ${n === 1 ? 'Coin' : 'Coins'}`,
  /** The pill's tap opens the sheet. */
  pillLabel: (n: number) => `${HEART_COINS_TEXT.label(n)}. See today's coins`,
  keepsRunning: 'Heart Coins keep your patch running.',
  heartLine: 'Heart Coins stay on this patch. Earn them by playing here.',
  patchLine: 'Patch Coins go everywhere with you. They buy clothes.',
  today: 'Today on this patch',
  allDone: 'All done today!',
  allDoneDay: "You've earned every Heart Coin for today. Wow!",
  resetsIn: (wait: string) => `More to earn in ${wait}`,
  resetsSoon: 'More to earn any minute now!',
  loading: 'Counting coins…',
  close: 'Close',
} as const;

/** A source the sheet shows a bar for, in order. */
export type HeartCoinRowSource = keyof HeartCoinsBySource;

/**
 * The bars, in order. Selling (`sell`) joins when the post's Sell tab ships
 * (#601 PR 4): until then there's no way to earn it, so no bar.
 */
export const HEART_COIN_ROWS: readonly HeartCoinRowSource[] = ['battle', 'capture', 'care'];

const ROW_TEXT: Readonly<Record<HeartCoinRowSource, { emoji: string; label: string }>> = {
  battle: { emoji: '🏆', label: 'Battle wins' },
  capture: { emoji: '🤝', label: 'New friends & land' },
  care: { emoji: '🧸', label: 'Caring' },
  sell: { emoji: '🏷️', label: 'Selling extras' },
};

export interface HeartCoinRow {
  readonly source: HeartCoinRowSource;
  readonly emoji: string;
  readonly label: string;
  readonly earned: number;
  readonly cap: number;
  /** 0–100, for the bar's width. */
  readonly percent: number;
  /** Nothing more from this today. */
  readonly full: boolean;
  /** "3 / 20", or "All done today!" once full. */
  readonly value: string;
}

export interface HeartCoinsPage {
  readonly balance: number;
  readonly rows: readonly HeartCoinRow[];
  /** Every bar is full. */
  readonly allFull: boolean;
  /** "More to earn in 5 h 12 min". */
  readonly resets: string;
}

export function heartCoinRow(
  source: HeartCoinRowSource,
  today: HeartCoinsBySource,
  caps: HeartCoinsBySource,
): HeartCoinRow {
  const cap = caps[source];
  const earned = Math.min(today[source], cap);
  const full = earned >= cap;
  return {
    source,
    ...ROW_TEXT[source],
    earned,
    cap,
    percent: cap > 0 ? Math.round((earned / cap) * 100) : 100,
    full,
    value: full ? HEART_COINS_TEXT.allDone : `${String(earned)} / ${String(cap)}`,
  };
}

/** "5 h 12 min", "12 min", "1 min": how long until `resetsAt`, rounded up to the minute. */
export function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** The sheet's words and bars at `nowMs` (the game clock, server time). */
export function heartCoinsPage(coins: HeartCoins, nowMs: number): HeartCoinsPage {
  const rows = HEART_COIN_ROWS.map((s) => heartCoinRow(s, coins.today, coins.caps));
  const left = Date.parse(coins.resetsAt) - nowMs;
  return {
    balance: coins.balance,
    rows,
    allFull: rows.every((r) => r.full),
    resets: left <= 0 ? HEART_COINS_TEXT.resetsSoon : HEART_COINS_TEXT.resetsIn(waitText(left)),
  };
}
