import { hpClose } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { islandMap } from './island-map.js';
import { forecastPage, WEATHER_TEXT } from './weather-model.js';
import type { WeatherStore } from './weather-store.js';
import './weather.css';

// The Forecast sheet (#621 W1-9): what the sky is doing over my home, the
// island map of today's fronts, and tomorrow. A Weather Vane unlocks every
// front with where it comes from and when; without one, tomorrow is a single
// line. A DOM sheet over the map, like Patch stats.

export interface ForecastSheet {
  readonly node: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

function lines(list: readonly string[]): HTMLElement {
  return el(
    'ul',
    { class: 'weather-sheet-list' },
    ...list.map((line) => el('li', { 'data-testid': 'weather-front' }, line)),
  );
}

export function createForecastSheet(root: HTMLElement, store: WeatherStore): ForecastSheet {
  const body = el('div', { class: 'weather-sheet-scroll' });
  const closeButton = hpClose(WEATHER_TEXT.close, 'weather-close');
  const node = el(
    'div',
    {
      class: 'weather-sheet',
      role: 'dialog',
      'aria-labelledby': 'weather-sheet-title',
      'data-testid': 'weather-sheet',
    },
    el(
      'div',
      { class: 'auth-card weather-sheet-card' },
      el(
        'div',
        { class: 'weather-sheet-head' },
        el('h2', { class: 'weather-sheet-title', id: 'weather-sheet-title' }, WEATHER_TEXT.title),
        closeButton,
      ),
      body,
    ),
  );
  node.hidden = true;
  root.append(node);

  const draw = (): void => {
    const view = store.view;
    const map = store.map;
    if (!view || !map) {
      body.replaceChildren(el('p', { class: 'weather-sheet-note' }, 'Looking at the sky…'));
      return;
    }
    const kind = store.kindNow();
    const page = forecastPage(view, kind, map.map.timeZone);
    const parts: Node[] = [
      el(
        'p',
        { class: 'weather-sheet-now', 'data-testid': 'weather-now', 'data-kind': kind },
        page.now,
      ),
      islandMap(map, view.today.fronts, store.home, store.now()),
    ];
    if (page.today) {
      parts.push(
        el('h3', {}, WEATHER_TEXT.todayHead),
        page.today.length ? lines(page.today) : el('p', {}, WEATHER_TEXT.nothingComing),
      );
    }
    parts.push(el('h3', {}, WEATHER_TEXT.tomorrowHead));
    if (page.tomorrow.summary !== null) {
      parts.push(
        // The server's line ends with its own emoji (shared `forecastLine`).
        el('p', { 'data-testid': 'weather-tomorrow' }, page.tomorrow.summary),
        el(
          'p',
          { class: 'weather-sheet-note', 'data-testid': 'weather-no-vane' },
          WEATHER_TEXT.noVane,
        ),
      );
    } else {
      parts.push(
        page.tomorrow.lines.length
          ? lines(page.tomorrow.lines)
          : el('p', {}, WEATHER_TEXT.nothingComing),
      );
    }
    parts.push(el('p', { class: 'weather-sheet-note' }, WEATHER_TEXT.stormTip));
    body.replaceChildren(...parts);
  };

  const sheet: ForecastSheet = {
    node,
    get isOpen() {
      return !node.hidden;
    },
    open() {
      node.hidden = false;
      draw();
      // A fresh read each time it opens, so a new vane shows at once.
      void store.refresh();
    },
    close() {
      node.hidden = true;
    },
  };
  closeButton.addEventListener('click', () => {
    sheet.close();
  });
  node.addEventListener('click', (e) => {
    if (e.target === node) sheet.close();
  });
  store.onChange(() => {
    if (!node.hidden) draw();
  });
  return sheet;
}
