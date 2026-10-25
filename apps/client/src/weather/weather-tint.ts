import type { WeatherKind } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import './weather.css';

/**
 * The sky's wash: a see-through layer over the map canvas (under the HUD),
 * not a change to the scene's clear colour, which the Hollow layer saves and
 * restores for night. `pointer-events: none`, so the map stays tappable.
 */
export interface WeatherTint {
  readonly node: HTMLElement;
  set(kind: WeatherKind): void;
  remove(): void;
}

export function createWeatherTint(root: HTMLElement): WeatherTint {
  const node = el('div', {
    class: 'weather-tint',
    'data-testid': 'weather-tint',
    'aria-hidden': 'true',
  });
  node.dataset['kind'] = 'clear';
  root.append(node);
  return {
    node,
    set: (kind) => {
      node.dataset['kind'] = kind;
    },
    remove: () => {
      node.remove();
    },
  };
}
