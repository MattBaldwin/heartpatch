import { el } from '../ui/dom.js';
import { WEATHER_EMOJI, WEATHER_TEXT } from './weather-model.js';
import type { WeatherStore } from './weather-store.js';
import './weather.css';

/**
 * The top-bar weather chip (#621 W1-9): one emoji for the sky over my home,
 * emoji-only so it fits beside the patch name on the smallest phone. Hidden
 * on a Cozy Patch. A tap opens the Forecast sheet.
 */
export interface WeatherChip {
  readonly node: HTMLButtonElement;
  /** Redraws from the store (it also does so on every store change). */
  refresh(): void;
}

export function createWeatherChip(store: WeatherStore, onTap: () => void): WeatherChip {
  const glyph = el('span', { class: 'weather-chip-glyph', 'aria-hidden': 'true' });
  const node = el(
    'button',
    { type: 'button', class: 'weather-chip', 'data-testid': 'weather-chip' },
    glyph,
  );
  node.hidden = true;
  node.addEventListener('click', onTap);
  const refresh = (): void => {
    const show = store.wild && store.view !== null;
    node.hidden = !show;
    if (!show) return;
    const kind = store.kindNow();
    glyph.textContent = WEATHER_EMOJI[kind];
    node.dataset['kind'] = kind;
    node.setAttribute('aria-label', WEATHER_TEXT.chipLabel(kind));
  };
  store.onChange(refresh);
  return { node, refresh };
}
