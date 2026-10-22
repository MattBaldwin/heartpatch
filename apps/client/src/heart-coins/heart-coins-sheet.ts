import type { HeartCoins } from '@heartpatch/shared';
import { el, messageOf } from '../ui/dom.js';
import {
  HEART_COINS_TEXT,
  heartCoinsPage,
  type HeartCoinRow,
  type HeartCoinsPage,
} from './heart-coins-model.js';

// The Heart Coins sheet (#601): my balance on this patch, today's coins by
// source against the day's caps, when more can be earned, and how Heart
// Coins differ from Patch Coins. A DOM sheet over the map or home (tech spec
// §6), like Patch stats.

export interface HeartCoinsSheet {
  /** Shows the sheet, "Counting…" until `show` or `fail` fills it. */
  open: () => void;
  /** Fills it from a fresh reply. */
  show: (coins: HeartCoins) => void;
  /** The read failed: says so kindly (a balance already shown stays). */
  fail: (err: unknown) => void;
  close: () => void;
  readonly isOpen: boolean;
  /** The page on screen; null while loading or shut. */
  readonly page: HeartCoinsPage | null;
}

export interface HeartCoinsSheetOptions {
  root: HTMLElement;
  /** The game clock in ms (the bag's `gameNow`): `resetsAt` is server time. */
  now: () => number;
}

/** How often the "More to earn in …" line counts down while open. */
const TICK_MS = 30_000;

function rowItem(row: HeartCoinRow): HTMLElement {
  const bar = el('span', { class: 'heart-sheet-bar' }, el('span', { class: 'heart-sheet-fill' }));
  (bar.firstElementChild as HTMLElement).style.width = `${String(row.percent)}%`;
  return el(
    'li',
    {
      class: row.full ? 'heart-sheet-row heart-sheet-row-full' : 'heart-sheet-row',
      'data-testid': 'heart-coins-row',
      'data-source': row.source,
    },
    el('span', { class: 'heart-sheet-emoji', 'aria-hidden': 'true' }, row.emoji),
    el('span', { class: 'heart-sheet-label' }, row.label),
    el('span', { class: 'heart-sheet-value' }, row.value),
    bar,
  );
}

export function createHeartCoinsSheet(options: HeartCoinsSheetOptions): HeartCoinsSheet {
  let coins: HeartCoins | null = null;
  let page: HeartCoinsPage | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const balance = el('p', { class: 'heart-sheet-balance', 'data-testid': 'heart-coins-balance' });
  const rows = el('ul', { class: 'heart-sheet-rows', 'aria-label': HEART_COINS_TEXT.today });
  const resets = el('p', { class: 'heart-sheet-resets', 'data-testid': 'heart-coins-resets' });
  const status = el('p', { class: 'heart-sheet-status', role: 'status' });
  const problem = el('p', { class: 'auth-error', role: 'alert' });
  const closeTop = el(
    'button',
    {
      type: 'button',
      class: 'heart-sheet-close-top',
      'aria-label': HEART_COINS_TEXT.close,
      'data-testid': 'heart-coins-close-top',
    },
    '×',
  );
  const close = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'heart-coins-close' },
    HEART_COINS_TEXT.close,
  );
  // Heart Coins next to Patch Coins, so the two are never mixed up.
  const compare = el(
    'ul',
    { class: 'heart-sheet-compare', 'data-testid': 'heart-coins-compare' },
    el(
      'li',
      { class: 'heart-sheet-compare-heart' },
      el('span', { class: 'heart-sheet-compare-icon', 'aria-hidden': 'true' }, '💛'),
      el('span', {}, HEART_COINS_TEXT.heartLine),
    ),
    el(
      'li',
      { class: 'heart-sheet-compare-patch' },
      el('span', { class: 'coin-icon heart-sheet-coin', 'aria-hidden': 'true' }),
      el('span', {}, HEART_COINS_TEXT.patchLine),
    ),
  );
  const panel = el(
    'section',
    {
      class: 'heart-sheet',
      role: 'dialog',
      'aria-labelledby': 'heart-sheet-title',
      'data-testid': 'heart-coins-sheet',
    },
    el(
      'div',
      { class: 'auth-card heart-sheet-card' },
      el(
        'div',
        { class: 'heart-sheet-head' },
        el(
          'h1',
          { class: 'auth-title heart-sheet-title', id: 'heart-sheet-title' },
          HEART_COINS_TEXT.title,
        ),
        closeTop,
      ),
      el(
        'div',
        { class: 'heart-sheet-scroll' },
        balance,
        el('p', { class: 'heart-sheet-lead' }, HEART_COINS_TEXT.keepsRunning),
        el('h2', { class: 'heart-sheet-subtitle' }, HEART_COINS_TEXT.today),
        status,
        rows,
        resets,
        problem,
        compare,
      ),
      el('div', { class: 'auth-actions heart-sheet-actions' }, close),
    ),
  );
  panel.hidden = true;
  options.root.append(panel);

  function draw(): void {
    if (!coins) return;
    page = heartCoinsPage(coins, options.now());
    status.textContent = page.allFull ? HEART_COINS_TEXT.allDoneDay : '';
    balance.replaceChildren(
      el('span', { class: 'heart-sheet-balance-icon', 'aria-hidden': 'true' }, '💛'),
      el('span', {}, String(page.balance)),
    );
    balance.setAttribute('aria-label', HEART_COINS_TEXT.label(page.balance));
    rows.replaceChildren(...page.rows.map(rowItem));
    resets.textContent = page.resets;
  }

  function stopTicking(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function hide(): void {
    stopTicking();
    page = null;
    panel.hidden = true;
  }
  close.addEventListener('click', hide);
  closeTop.addEventListener('click', hide);

  return {
    open: () => {
      coins = null;
      page = null;
      balance.replaceChildren();
      balance.removeAttribute('aria-label');
      rows.replaceChildren();
      resets.textContent = '';
      status.textContent = HEART_COINS_TEXT.loading;
      problem.textContent = '';
      panel.hidden = false;
      stopTicking();
      timer = setInterval(draw, TICK_MS);
    },
    show: (next) => {
      if (panel.hidden) return;
      coins = next;
      problem.textContent = '';
      draw();
    },
    fail: (err) => {
      if (panel.hidden) return;
      status.textContent = '';
      problem.textContent = messageOf(err);
    },
    close: hide,
    get isOpen() {
      return !panel.hidden;
    },
    get page() {
      return page;
    },
  };
}
