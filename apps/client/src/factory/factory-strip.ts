import type { FactoryView } from '@heartpatch/shared';
import { formatWait } from '../inventory/game-clock.js';
import { el } from '../ui/dom.js';
import { batchRows, FACTORY_TEXT, goingCount, type BatchRow } from './factory-view.js';

// The Factory strip (#294): each batch's item, done/total and a countdown,
// in the Bag and the Recipe Book. Built when the batches change; the tick
// rewrites its texts in place (one Text node each, DECISIONS Fix PR #173).

export interface FactoryStrip {
  readonly element: HTMLElement;
  /** Draws for this Factory (null: none, hidden). */
  update: (view: FactoryView | null) => void;
  pause: () => void;
}

const left = (row: BatchRow, nowMs: number) =>
  `${String(row.done)}/${String(row.total)} · ${
    row.finished ? '✨' : formatWait(Date.parse(row.batch.doneAt) - nowMs)
  }`;

/** `now`: the game clock in ms. A tap on the strip calls `onTap` (open the Factory panel). */
export function createFactoryStrip(now: () => number, onTap?: () => void): FactoryStrip {
  let view: FactoryView | null = null;
  let ticker: number | undefined;
  let texts: { text: Text; row: BatchRow }[] = [];
  const element = el('div', { class: 'factory-strip', 'data-testid': 'factory-strip' });
  element.hidden = true;
  if (onTap) {
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.addEventListener('click', onTap);
    element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onTap();
    });
  }

  function render(): void {
    texts = [];
    element.hidden = view === null || view.batches.length === 0;
    if (!view || element.hidden) {
      element.replaceChildren();
      pause();
      return;
    }
    const at = now();
    const rows = batchRows(view, at);
    element.replaceChildren(
      el(
        'div',
        { class: 'factory-strip-head' },
        FACTORY_TEXT.stripTitle,
        el('span', {}, FACTORY_TEXT.strip(goingCount(view, at), view.slots)),
      ),
      ...rows.map((row) => {
        const text = document.createTextNode(left(row, at));
        texts.push({ text, row });
        return el(
          'div',
          { class: 'factory-mini', 'data-batch': row.batch.id },
          el('span', { 'aria-hidden': 'true' }, row.icon),
          el(
            'span',
            { class: 'factory-bar', 'aria-hidden': 'true' },
            el('i', { style: `width:${String(row.percent)}%` }),
          ),
          el('span', { 'aria-label': row.name }, text),
        );
      }),
    );
    if (ticker === undefined) ticker = window.setInterval(tick, 1000);
  }

  function tick(): void {
    if (!element.isConnected || !view) {
      pause();
      return;
    }
    const at = now();
    const rows = batchRows(view, at);
    for (const t of texts) {
      const row = rows.find((r) => r.batch.id === t.row.batch.id);
      if (!row) continue;
      if (row.done !== t.row.done) {
        render();
        return;
      }
      t.text.data = left(row, at);
    }
  }

  function pause(): void {
    if (ticker !== undefined) window.clearInterval(ticker);
    ticker = undefined;
  }

  return {
    element,
    update: (next) => {
      view = next;
      render();
    },
    pause,
  };
}
