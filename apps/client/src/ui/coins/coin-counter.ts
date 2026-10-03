import { el } from '../dom.js';
import './coins.css';

// The Patch Coin counter (design doc §23, #45): a small gold pill with the
// account's balance. The server owns the number (CLAUDE.md rule 1); this
// only shows what it last said.

/** "12 Patch Coins", for screen readers; the pill itself shows the number. */
export const coinsLabel = (n: number) => `${String(n)} Patch Coins`;

export interface CoinPill {
  readonly node: HTMLElement;
  /** Shows a balance, or hides the pill (null: not known yet). */
  set: (balance: number | null) => void;
  readonly balance: number | null;
}

export function createCoinPill(testId: string): CoinPill {
  const amount = el('span', { class: 'coin-amount' });
  const node = el(
    'span',
    { class: 'coin-pill', role: 'status', 'data-testid': testId },
    el('span', { class: 'coin-icon', 'aria-hidden': 'true' }),
    amount,
  );
  node.hidden = true;
  let balance: number | null = null;
  return {
    node,
    set: (next) => {
      balance = next;
      node.hidden = next === null;
      amount.textContent = next === null ? '' : String(next);
      node.setAttribute('aria-label', next === null ? '' : coinsLabel(next));
    },
    get balance() {
      return balance;
    },
  };
}

export interface CoinCounter extends CoinPill {
  /** Asks the server for the balance again (a failed read keeps the last one). */
  refresh: () => Promise<void>;
}

/** A pill that fetches its own balance (the lobby's). */
export function createCoinCounter(options: {
  testId: string;
  fetchBalance: () => Promise<number>;
}): CoinCounter {
  const pill = createCoinPill(options.testId);
  let asked = 0;
  return {
    ...pill,
    get balance() {
      return pill.balance;
    },
    refresh: async () => {
      const mine = (asked += 1);
      try {
        const balance = await options.fetchBalance();
        if (mine === asked) pill.set(balance);
      } catch {
        // Offline or logged out: keep showing the last balance.
      }
    },
  };
}
