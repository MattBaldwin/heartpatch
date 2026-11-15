import type { ShopView } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { postConfirm } from './post-confirm.js';
import { confirmContent, receipt, SHOP_TEXT, shopCards, type ShopCard } from './shop-model.js';

// The post's Shop tab (#729; the owner-approved mockup v3): one card per
// item with its price pill and Buy, the confirm sheet before anything is
// spent, and a green receipt after. The post screen owns the state and the
// buying; the server prices, caps and applies every purchase.

type ButtonKind = 'primary' | 'secondary' | 'gold' | 'quiet';

export interface ShopTabState {
  /** Null until the first read arrives. */
  readonly view: ShopView | null;
  /** Which card's confirm sheet is up. */
  readonly confirming: ShopCard['id'] | null;
  /** The last buy's receipt, until the next step. */
  readonly receipt: { readonly title: string; readonly line: string } | null;
  /** A refusal or a failed read, in place of the list when there's no view. */
  readonly note: string;
  readonly passOver: boolean;
  readonly nowMs: number;
}

export interface ShopTabDeps {
  button: (
    label: string,
    testId: string,
    kind: ButtonKind,
    onClick: () => void,
    disabled?: boolean,
  ) => HTMLButtonElement;
  onAsk: (id: ShopCard['id']) => void;
  onCancel: () => void;
  onBuy: (id: ShopCard['id']) => void;
}

export function shopTab(state: ShopTabState, deps: ShopTabDeps): Node[] {
  const { view, button } = { view: state.view, button: deps.button };
  const noteNode = state.note
    ? [
        el(
          'p',
          { class: 'post-shop-note', role: 'alert', 'data-testid': 'post-shop-note' },
          state.note,
        ),
      ]
    : [];
  if (!view) {
    return state.note ? noteNode : [el('p', { class: 'post-tiny' }, SHOP_TEXT.loading)];
  }
  const cards = shopCards(view, state.nowMs);
  const parts: Node[] = [
    el(
      'div',
      { class: 'shop-top' },
      el('span', { class: 'post-small' }, SHOP_TEXT.balance),
      el(
        'span',
        { class: 'shop-price', 'data-testid': 'post-shop-balance' },
        SHOP_TEXT.price(view.balance),
      ),
    ),
    ...noteNode,
  ];
  if (state.receipt) {
    parts.push(
      el(
        'div',
        {
          class: 'post-card post-sell-done shop-card',
          role: 'status',
          'data-testid': 'post-shop-done',
        },
        el('b', {}, state.receipt.title),
        el('span', { class: 'post-small' }, state.receipt.line),
      ),
    );
  }
  parts.push(
    el(
      'div',
      { class: 'shop-list', 'data-testid': 'post-shop-list' },
      ...cards.map((card) => cardNode(card)),
    ),
  );
  const asking = cards.find((c) => c.id === state.confirming);
  if (asking) {
    const content = confirmContent(asking, view.balance);
    parts.push(
      postConfirm({
        title: content.title,
        testId: 'post-shop-confirm',
        lines: content.rows,
        after: content.after,
        note: content.line,
        yes: SHOP_TEXT.yes,
        no: SHOP_TEXT.no,
        button,
        onYes: () => {
          deps.onBuy(asking.id);
        },
        onNo: deps.onCancel,
        yesDisabled: state.passOver,
      }),
    );
  }
  return parts;

  function cardNode(card: ShopCard): HTMLElement {
    return el(
      'div',
      {
        class: `post-card shop-card${card.cream ? ' cream' : ''}`,
        'data-item': card.id,
        'data-state': card.state
          ? card.state.glow
            ? 'held'
            : 'capped'
          : card.canBuy
            ? 'buy'
            : 'poor',
      },
      el(
        'div',
        { class: 'post-row shop-head' },
        el('span', { class: 'post-icon', 'aria-hidden': 'true' }, card.icon),
        el(
          'div',
          { class: 'post-grow' },
          el('p', { class: 'shop-name' }, card.name),
          el('p', { class: 'shop-line' }, card.line),
          ...(card.cap ? [el('p', { class: 'shop-cap' }, card.cap)] : []),
        ),
      ),
      ...(card.state
        ? [
            el(
              'div',
              {
                class: `shop-state${card.state.glow ? ' glow' : ''}`,
                'data-testid': `post-shop-state-${card.id}`,
              },
              card.state.text,
            ),
          ]
        : []),
      el(
        'div',
        { class: 'shop-foot' },
        el('span', { class: 'shop-price' }, SHOP_TEXT.price(card.price)),
        button(
          SHOP_TEXT.buy,
          `post-shop-buy-${card.id}`,
          'primary',
          () => {
            deps.onAsk(card.id);
          },
          !card.canBuy || state.passOver,
        ),
      ),
      ...(card.why
        ? [el('p', { class: 'shop-why', 'data-testid': `post-shop-why-${card.id}` }, card.why)]
        : []),
    );
  }
}

export { receipt };
