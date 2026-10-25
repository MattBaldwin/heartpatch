import type { SellBasketResponse, SellLine, SellView } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { hoursToReset } from './glimmer-swap-model.js';
import { postConfirm } from './post-confirm.js';
import {
  basketLines,
  basketTotals,
  canAdd,
  capMeter,
  confirmContent,
  hasSpares,
  lotsIn,
  rowKey,
  rowNote,
  SELL_TEXT,
  sellCapped,
  sellRows,
  sparesPlan,
  type SellBasket,
  type SellConfirm,
  type SellRow,
} from './sell-model.js';

// The post's Sell tab (#601 PR 4; #655 part C, the owner-approved mockup v4),
// drawn from its state. The list is for picking and counting: a − N + on each
// row. The sticky bar at the bottom shows what's picked, what it pays and
// today's cap meter, carries any refusal, and does the selling, through the
// one confirm sheet. ✨ Sell all spares opens the same sheet with the shared
// planner's lines. The post screen owns the state and the sale.

type ButtonKind = 'primary' | 'secondary' | 'gold' | 'quiet';

export type { SellConfirm };

/** The cap meter's two fills, as parts of the cap (`capMeter`). */
export interface MeterParts {
  readonly now: number;
  readonly after: number;
}

export interface SellTabState {
  /** Null until the first read arrives. */
  readonly view: SellView | null;
  readonly basket: SellBasket;
  readonly confirm: SellConfirm | null;
  /** The last sale, for the success card (cleared by the next step). */
  readonly sold: SellBasketResponse['sold'] | null;
  /** A refusal or a failed read, shown in the bar (never at the top, #655). */
  readonly barNote: string;
  /** The visit pass ran out: nothing sells. */
  readonly passOver: boolean;
  readonly nowMs: number;
  /** The meter as last drawn, so a change slides instead of jumping. */
  readonly meterFrom: MeterParts | null;
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
  onStep: (row: SellRow, delta: 1 | -1) => void;
  onConfirm: (which: SellConfirm) => void;
  onCancel: () => void;
  onSell: (lines: SellLine[]) => void;
}

/** What the tab drew: its nodes, and the meter it shows (for the next draw's slide). */
export interface SellTabParts {
  readonly nodes: Node[];
  readonly meter: MeterParts | null;
}

export function sellTab(state: SellTabState, deps: SellTabDeps): SellTabParts {
  const { view } = state;
  if (!view) {
    return {
      nodes: [
        el('p', { class: 'post-tiny' }, '…'),
        ...(state.barNote ? [el('div', { class: 'post-send-bar post-sell-bar' }, barNote())] : []),
      ],
      meter: null,
    };
  }
  const { button } = deps;
  /** The view, narrowed for the functions below. */
  const v: SellView = view;
  const rows = sellRows(view);
  const capped = sellCapped(view);
  const lines = basketLines(state.basket, rows);
  const totals = basketTotals(lines);
  const meter = capMeter(view, totals.coins);
  const plan = sparesPlan(view);

  const head = el(
    'div',
    { class: 'post-swap-head' },
    el(
      'span',
      { class: 'post-sell-today', 'data-testid': 'post-sell-today' },
      SELL_TEXT.today(view),
    ),
    ...(hasSpares(view)
      ? [
          button(
            SELL_TEXT.spares,
            'post-sell-spares',
            'gold',
            () => {
              deps.onConfirm('spares');
            },
            plan.length === 0 || state.passOver,
          ),
        ]
      : []),
  );
  const parts: Node[] = [head];

  if (state.sold) {
    parts.push(
      el(
        'div',
        { class: 'post-card post-sell-done', role: 'status', 'data-testid': 'post-sell-done' },
        el('b', {}, SELL_TEXT.done(state.sold)),
        el('span', { class: 'post-small' }, SELL_TEXT.doneLines(state.sold)),
      ),
    );
  }

  if (capped) {
    parts.push(
      el(
        'div',
        { class: 'post-card post-card-cream', 'data-testid': 'post-sell-capped' },
        el('b', {}, SELL_TEXT.capped),
        el('span', { class: 'post-small' }, SELL_TEXT.resetsIn(hoursToReset(view, state.nowMs))),
      ),
    );
  }

  if (rows.length === 0) {
    parts.push(
      el('p', { class: 'post-tiny', 'data-testid': 'post-sell-empty' }, SELL_TEXT.nothing),
    );
  } else {
    const items = rows.filter((r) => r.kind === 'item');
    const pieces = rows.filter((r) => r.kind === 'clothing');
    if (items.length > 0) {
      parts.push(
        el(
          'div',
          { class: 'post-swap-list post-sell-list', 'data-testid': 'post-sell-rows' },
          ...items.map(rowCard),
        ),
      );
    }
    if (pieces.length > 0) {
      parts.push(
        el(
          'div',
          { class: 'post-sell-section' },
          el('h3', {}, SELL_TEXT.clothingHead),
          el('span', { class: 'post-small' }, SELL_TEXT.keepsOne),
        ),
        el(
          'div',
          { class: 'post-swap-list post-sell-list', 'data-testid': 'post-sell-clothing' },
          ...pieces.map(rowCard),
        ),
      );
    }
  }
  parts.push(
    el(
      'p',
      { class: 'post-tiny post-sell-stays', 'data-testid': 'post-sell-stays' },
      SELL_TEXT.stays,
    ),
  );
  if (rows.length > 0 || state.barNote) parts.push(sellBar());

  const sheet = state.confirm ? confirmSheet(state.confirm) : null;
  if (sheet) parts.push(sheet);
  return { nodes: parts, meter };

  function barNote(): HTMLElement {
    return el(
      'p',
      { class: 'post-sell-bar-note', role: 'alert', 'data-testid': 'post-sell-bar-note' },
      state.barNote,
    );
  }

  function rowCard(row: SellRow): HTMLElement {
    const lots = lotsIn(state.basket, row);
    const step = (delta: 1 | -1, off: boolean) => {
      const b = button(
        delta === 1 ? '+' : '−',
        `post-sell-${delta === 1 ? 'more' : 'less'}-${row.itemId}`,
        delta === 1 ? 'primary' : 'secondary',
        () => {
          deps.onStep(row, delta);
        },
        off || state.passOver,
      );
      b.setAttribute('aria-label', (delta === 1 ? SELL_TEXT.more : SELL_TEXT.less)(row.name));
      return b;
    };
    const note = rowNote(row, lots, capped);
    return el(
      'div',
      {
        class: `post-card post-row post-sell-row${lots > 0 ? ' in' : ''}`,
        'data-item': row.itemId,
        'data-key': rowKey(row),
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
          el(
            'span',
            {},
            row.kind === 'item' ? SELL_TEXT.have(row.have) : SELL_TEXT.spare(row.maxLots),
          ),
          ' · ',
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
      el(
        'div',
        { class: 'post-sell-step' },
        el(
          'div',
          { class: 'post-stepper' },
          step(-1, lots === 0),
          el(
            'span',
            { class: 'post-sell-count', 'data-testid': `post-sell-count-${row.itemId}` },
            String(lots * row.lot),
          ),
          step(1, !canAdd(v, state.basket, row, rows)),
        ),
        el(
          'span',
          {
            class: `post-sell-earn${lots > 0 ? '' : ' why'}`,
            'data-testid': `post-sell-note-${row.itemId}`,
          },
          note,
        ),
      ),
    );
  }

  function sellBar(): HTMLElement {
    const some = lines.length > 0;
    const fill = (cls: string, part: number, from: number | undefined) => {
      const i = el('i', { class: cls });
      i.style.width = `${String((from ?? part) * 100)}%`;
      if (from !== undefined && from !== part) {
        // Two frames, so the browser draws the old width before the slide.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            i.style.width = `${String(part * 100)}%`;
          });
        });
      }
      return i;
    };
    return el(
      'div',
      { class: 'post-send-bar post-sell-bar', 'data-testid': 'post-sell-bar' },
      ...(state.barNote ? [barNote()] : []),
      el(
        'div',
        { class: 'post-sell-sum' },
        el(
          'b',
          { 'data-testid': 'post-sell-summary' },
          ...(some
            ? [
                `${SELL_TEXT.things(totals.quantity)} · `,
                el('em', {}, SELL_TEXT.coins(totals.coins)),
              ]
            : [SELL_TEXT.nothingPicked]),
        ),
        el(
          'span',
          {
            class: 'post-sell-meter',
            'aria-hidden': 'true',
            'data-testid': 'post-sell-meter',
            'data-now': String(meter.now),
            'data-after': String(meter.after),
          },
          fill('after', meter.after, state.meterFrom?.after),
          fill('now', meter.now, state.meterFrom?.now),
        ),
        el(
          'span',
          { class: 'post-small', 'data-testid': 'post-sell-meter-text' },
          some ? SELL_TEXT.meterAfter(v, totals.coins) : SELL_TEXT.meterNow(v),
        ),
      ),
      button(
        SELL_TEXT.sell,
        'post-sell-go',
        'primary',
        () => {
          deps.onConfirm('basket');
        },
        !some || state.passOver,
      ),
    );
  }

  function confirmSheet(which: SellConfirm): HTMLElement | null {
    const content = confirmContent(v, which, state.basket);
    if (!content) return null;
    return postConfirm({
      title: content.title,
      testId: 'post-sell-confirm',
      lines: content.rows,
      total: content.total,
      after: content.after,
      stays: content.stays,
      note: content.note,
      yes: SELL_TEXT.yes,
      no: SELL_TEXT.no,
      button,
      onYes: () => {
        deps.onSell(content.lines);
      },
      onNo: deps.onCancel,
      yesDisabled: state.passOver,
    });
  }
}
