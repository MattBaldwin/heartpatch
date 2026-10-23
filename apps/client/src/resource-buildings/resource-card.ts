import { el } from '../ui/dom.js';
import type { ResourceCard } from './resource-model.js';
import './resource-buildings.css';

// A resource building's tile card lines (#601 PR 7): what it's doing, its
// storage meter, the next batch and its morning upkeep. The home screen's
// standing card around it adds Upgrade and Take down, as for the Training
// Grounds and the Factory.

/**
 * The card's lines for one state (`resourceCard`), with the Warehouse's 📦
 * mark under the meter when it has one (`deliveryMark`, #601 PR 9).
 */
export function resourceCardLines(card: ResourceCard, mark: string | null = null): Node[] {
  const fill = el('span', { class: 'resource-meter-fill' });
  fill.style.width = `${String(card.percent)}%`;
  const asleep = card.state === 'paused' || card.state === 'napping' || card.state === 'dormant';
  const meter = el(
    'div',
    {
      class: `resource-meter resource-meter-${card.state}`,
      'data-testid': 'tile-resource-meter',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': String(card.max ?? card.stored),
      'aria-valuenow': String(card.stored),
      'aria-label': card.meter,
    },
    el('span', { class: 'resource-meter-bar', 'aria-hidden': 'true' }, fill),
    el('span', { class: 'resource-meter-text' }, card.meter),
  );
  return [
    el(
      'p',
      {
        class: `home-card-note resource-line${asleep ? ' resource-line-asleep' : ''}${card.state === 'full' ? ' resource-line-full' : ''}`,
        'data-testid': 'tile-resource-note',
        'data-state': card.state,
      },
      card.line,
    ),
    meter,
    ...(mark
      ? [
          el(
            'p',
            {
              class: `resource-delivery${card.max === null ? '' : ' resource-delivery-off'}`,
              'data-testid': 'tile-resource-delivery',
            },
            mark,
          ),
        ]
      : []),
    el(
      'p',
      { class: 'resource-facts' },
      ...(card.next ? [el('span', { 'data-testid': 'tile-resource-next' }, card.next)] : []),
      el('span', { 'data-testid': 'tile-resource-upkeep' }, card.upkeep),
    ),
  ];
}
