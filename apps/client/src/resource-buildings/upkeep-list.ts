import type { HeartCoins } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { RESOURCE_TEXT, moveInOrder, upkeepSection } from './resource-model.js';
import './resource-buildings.css';

// The Heart Coins sheet's morning upkeep (#601 PR 7): what the next morning
// costs, each building that pays it in charge order (a napping one owes
// nothing), and the kid's own order (owner decision Q5): ▲ and ▼ move a
// building, and the whole order goes to the server at once. The server
// charges in that order (PR 6); this only shows and sends it.

export interface UpkeepList {
  readonly element: HTMLElement;
  /** Fills it from a reply (hidden when I have no upkeep buildings). */
  show: (coins: HeartCoins, msUntilMorning: number) => void;
  /** Whether the order is being saved (a tap is on its way). */
  readonly saving: boolean;
}

export interface UpkeepListOptions {
  /** Saves a new order, first first; resolves once the server has it. */
  onOrder: (buildingIds: readonly string[]) => Promise<void>;
  /** The save failed: says why. */
  onError: (err: unknown) => void;
}

export function createUpkeepList(options: UpkeepListOptions): UpkeepList {
  const total = el('p', { class: 'upkeep-total', 'data-testid': 'upkeep-total' });
  const hint = el('p', { class: 'upkeep-hint' }, RESOURCE_TEXT.upkeepOrderHint);
  const rows = el('ol', {
    class: 'upkeep-rows',
    'data-testid': 'upkeep-rows',
    'aria-label': RESOURCE_TEXT.upkeepTitle,
  });
  const element = el(
    'section',
    { class: 'upkeep-section', 'data-testid': 'upkeep-section' },
    el('h2', { class: 'heart-sheet-subtitle' }, RESOURCE_TEXT.upkeepTitle),
    total,
    hint,
    rows,
  );
  element.hidden = true;
  let saving = false;
  let last: { coins: HeartCoins; ms: number } | null = null;

  function draw(coins: HeartCoins, ms: number): void {
    const section = upkeepSection(coins.upkeep, ms);
    element.hidden = section === null;
    if (!section) return;
    total.textContent = section.total;
    hint.hidden = !section.canOrder;
    const ids = section.rows.map((r) => r.buildingRowId);
    const move = (id: string, by: -1 | 1) => {
      if (saving) return;
      const next = moveInOrder(ids, id, by);
      if (next.every((v, i) => v === ids[i])) return;
      saving = true;
      // Shown in its new place at once; the server's reply redraws it.
      const due = coins.upkeep?.due ?? [];
      const moved = next.flatMap((n) => due.filter((d) => d.buildingRowId === n));
      if (coins.upkeep) draw({ ...coins, upkeep: { ...coins.upkeep, due: moved } }, ms);
      options
        .onOrder(next)
        .catch((err: unknown) => {
          options.onError(err);
          if (last) draw(last.coins, last.ms);
        })
        .finally(() => {
          saving = false;
        });
    };
    rows.replaceChildren(
      ...section.rows.map((row, i) => {
        const arrow = (by: -1 | 1) => {
          const b = el(
            'button',
            {
              type: 'button',
              class: 'upkeep-arrow',
              'aria-label':
                by < 0 ? RESOURCE_TEXT.moveUp(row.name) : RESOURCE_TEXT.moveDown(row.name),
              'data-testid': by < 0 ? 'upkeep-up' : 'upkeep-down',
            },
            by < 0 ? '▲' : '▼',
          );
          b.disabled = by < 0 ? row.first : row.last;
          b.addEventListener('click', () => {
            move(row.buildingRowId, by);
          });
          return b;
        };
        return el(
          'li',
          {
            class: `upkeep-row${row.paused ? ' upkeep-row-paused' : ''}`,
            'data-testid': 'upkeep-row',
            'data-building': row.buildingRowId,
          },
          el('span', { class: 'upkeep-place', 'aria-hidden': 'true' }, String(i + 1)),
          el(
            'span',
            { class: 'upkeep-name' },
            `${row.icon} ${row.name}`,
            el('span', { class: 'upkeep-level' }, `Level ${String(row.level)}`),
          ),
          el('span', { class: 'upkeep-coins' }, row.coins),
          ...(section.canOrder
            ? [el('span', { class: 'upkeep-arrows' }, arrow(-1), arrow(1))]
            : []),
        );
      }),
    );
  }

  return {
    element,
    show: (coins, ms) => {
      if (saving) return;
      last = { coins, ms };
      draw(coins, ms);
    },
    get saving() {
      return saving;
    },
  };
}
