import { el } from '../ui/dom.js';
import { HEART_COINS_TEXT } from './heart-coins-model.js';

// The 💛 Heart Coin pill (#601): the Patch Coin pill's twin (ui/coins), pink
// and with a heart instead of a gold coin, so the two never look alike. It's
// a button: a tap opens the Heart Coins sheet. The server owns the number
// (CLAUDE.md rule 1); this only shows what it last said.

export interface HeartPill {
  readonly node: HTMLButtonElement;
  /** Shows a balance, or hides the pill (null: not known yet, or no coins here). */
  set: (balance: number | null) => void;
}

/** `where` styles each copy (`map`, `home`); `data-where` tells them apart in tests. */
export function createHeartPill(where: string, onTap: () => void): HeartPill {
  const amount = el('span', { class: 'heart-pill-amount' });
  const node = el(
    'button',
    {
      type: 'button',
      class: `heart-pill heart-pill-${where}`,
      'data-testid': 'heart-coins',
      'data-where': where,
    },
    el('span', { class: 'heart-pill-icon', 'aria-hidden': 'true' }, '💛'),
    amount,
  );
  node.hidden = true;
  node.addEventListener('click', onTap);
  return {
    node,
    set: (balance) => {
      node.hidden = balance === null;
      amount.textContent = balance === null ? '' : String(balance);
      node.setAttribute('aria-label', balance === null ? '' : HEART_COINS_TEXT.pillLabel(balance));
    },
  };
}
