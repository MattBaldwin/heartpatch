import type { SellResponse, SellView } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import {
  clampLots,
  pickTotals,
  SELL_TEXT,
  sellCapped,
  sellHoursToReset,
  sellRows,
  type SellPick,
  type SellRow,
} from './sell-model.js';

// The post's Sell tab (#601 PR 4), drawn from its state. The post screen owns
// the state and the sale; this only lays out the cap line, the success card,
// the confirm with its lot stepper, the rows and the "stays with you" line.

type ButtonKind = 'primary' | 'secondary' | 'gold';

export interface SellTabState {
  /** Null until the first read arrives. */
  readonly view: SellView | null;
  readonly pick: SellPick | null;
  /** The last sale, for the success card (cleared by the next pick). */
  readonly sold: SellResponse['sold'] | null;
  /** The visit pass ran out: nothing sells. */
  readonly passOver: boolean;
  readonly nowMs: number;
}

export interface SellTabDeps {
  /** The post screen's button (it greys out while a command is working). */
  button: (
    label: string,
    testId: string,
    kind: ButtonKind,
    onClick: () => void,
    disabled?: boolean,
  ) => HTMLButtonElement;
  onPick: (row: SellRow) => void;
  onLots: (lots: number) => void;
  onCancel: () => void;
  onSell: (pick: SellPick) => void;
}

export function sellTab(state: SellTabState, deps: SellTabDeps): Node[] {
  const { view } = state;
  if (!view) return [el('p', { class: 'post-tiny' }, '…')];
  const { button } = deps;
  const rows = sellRows(view);
  const capped = sellCapped(view);

  const parts: Node[] = [
    el(
      'div',
      { class: 'post-swap-head' },
      el('b', { class: 'post-small' }, SELL_TEXT.intro),
      el(
        'span',
        { class: 'post-sell-today', 'data-testid': 'post-sell-today' },
        SELL_TEXT.today(view),
      ),
    ),
  ];

  if (state.sold) {
    parts.push(
      el(
        'div',
        { class: 'post-card post-sell-done', role: 'status', 'data-testid': 'post-sell-done' },
        el('b', {}, SELL_TEXT.done(state.sold)),
        el('span', { class: 'post-small' }, SELL_TEXT.doneLine(state.sold)),
      ),
    );
  }

  if (capped) {
    parts.push(
      el(
        'div',
        { class: 'post-card post-card-cream', 'data-testid': 'post-sell-capped' },
        el('b', {}, SELL_TEXT.capped),
        el(
          'span',
          { class: 'post-small' },
          SELL_TEXT.resetsIn(sellHoursToReset(view, state.nowMs)),
        ),
      ),
    );
  }

  const picked = state.pick && rows.find((r) => r.itemId === state.pick?.itemId);
  if (state.pick && picked && picked.maxLots > 0) {
    parts.push(confirmCard({ ...state.pick, lots: clampLots(state.pick.lots, picked) }, picked));
  }

  if (rows.length === 0) {
    parts.push(
      el('p', { class: 'post-tiny', 'data-testid': 'post-sell-empty' }, SELL_TEXT.nothing),
    );
  } else {
    parts.push(
      el(
        'div',
        { class: 'post-swap-list', 'data-testid': 'post-sell-rows' },
        ...rows.map((row) => rowCard(row)),
      ),
    );
  }
  parts.push(
    el(
      'p',
      { class: 'post-tiny post-sell-stays', 'data-testid': 'post-sell-stays' },
      SELL_TEXT.stays,
    ),
  );
  return parts;

  function rowCard(row: SellRow): HTMLElement {
    const label =
      row.block === 'short' && row.kind === 'item' ? SELL_TEXT.need(row.lot) : SELL_TEXT.sell;
    return el(
      'div',
      {
        class: `post-card post-row post-swap-card${row.itemId === state.pick?.itemId ? ' picked' : ''}`,
        'data-item': row.itemId,
        'data-block': row.block,
      },
      el('span', { class: 'post-icon', 'aria-hidden': 'true' }, row.icon),
      el(
        'div',
        { class: 'post-grow' },
        el('b', { class: 'post-fit' }, row.name),
        el(
          'div',
          { class: 'post-small post-sell-line' },
          // Two unbreakable halves: a narrow phone wraps between them, never inside.
          el('span', {}, SELL_TEXT.have(row.have)),
          ' ',
          el('span', { class: 'post-sell-price' }, SELL_TEXT.price(row.lot, row.coins)),
        ),
        ...(row.keepLine
          ? [
              el(
                'div',
                {
                  class: 'post-small post-sell-keep',
                  'data-testid': `post-sell-keep-${row.itemId}`,
                },
                row.keepLine,
              ),
            ]
          : []),
      ),
      button(
        label,
        `post-sell-${row.itemId}`,
        'gold',
        () => {
          deps.onPick(row);
        },
        row.maxLots === 0 || state.passOver,
      ),
    );
  }

  function confirmCard(pick: SellPick, row: SellRow): HTMLElement {
    const { quantity, coins } = pickTotals(pick, row);
    const stepper =
      row.maxLots > 1
        ? [
            el(
              'div',
              { class: 'post-stepper post-sell-stepper', 'data-testid': 'post-sell-stepper' },
              button(
                '−',
                'post-sell-less',
                'secondary',
                () => {
                  deps.onLots(pick.lots - 1);
                },
                pick.lots <= 1,
              ),
              el(
                'span',
                { class: 'post-sell-lots', 'data-testid': 'post-sell-lots' },
                `${String(quantity)} ${row.icon}`,
              ),
              button(
                '+',
                'post-sell-more',
                'secondary',
                () => {
                  deps.onLots(pick.lots + 1);
                },
                pick.lots >= row.maxLots,
              ),
            ),
          ]
        : [];
    const card = el(
      'div',
      { class: 'post-card post-swap-confirm', 'data-testid': 'post-sell-confirm' },
      el('b', {}, SELL_TEXT.confirm(quantity, pick.itemId, coins)),
      ...stepper,
      el('span', { class: 'post-small' }, SELL_TEXT.noUndo),
      el(
        'div',
        { class: 'post-row' },
        button(SELL_TEXT.no, 'post-sell-no', 'secondary', deps.onCancel),
        button(
          SELL_TEXT.yes,
          'post-sell-yes',
          'primary',
          () => {
            deps.onSell(pick);
          },
          state.passOver,
        ),
      ),
    );
    // The stepper's − and + say what they do to a screen reader.
    card
      .querySelector('[data-testid="post-sell-less"]')
      ?.setAttribute('aria-label', SELL_TEXT.less);
    card
      .querySelector('[data-testid="post-sell-more"]')
      ?.setAttribute('aria-label', SELL_TEXT.more);
    return card;
  }
}
