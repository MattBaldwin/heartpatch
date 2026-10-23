import { el } from '../ui/dom.js';
import type { WarehouseCard } from './warehouse-model.js';
import './resource-buildings.css';

// The Warehouse's tile card lines (#601 PR 9): what it's doing (delivering,
// needs 💛, napping), how many buildings it delivers for, and its morning
// upkeep. The home screen's standing card around it adds Take down, as for
// the resource buildings.

/** The card's lines for one state (`warehouseCard`). */
export function warehouseCardLines(card: WarehouseCard): Node[] {
  return [
    el(
      'p',
      {
        class: `home-card-note${card.state === 'delivering' ? '' : ' warehouse-line-asleep'}`,
        'data-testid': 'tile-warehouse-note',
        'data-state': card.state,
      },
      card.line,
    ),
    ...(card.count
      ? [
          el(
            'p',
            { class: 'resource-delivery', 'data-testid': 'tile-warehouse-count' },
            `📦 ${card.count}`,
          ),
        ]
      : []),
    el(
      'p',
      { class: 'resource-facts' },
      el('span', { 'data-testid': 'tile-warehouse-upkeep' }, card.upkeep),
    ),
  ];
}
