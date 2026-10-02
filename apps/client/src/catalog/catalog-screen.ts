import { GAME_DATA, type PublicUser } from '@heartpatch/shared';
import { el, messageOf } from '../ui/dom.js';
import { catalogApi } from './catalog-api.js';
import { catalogPage, type CatalogPage } from './catalog-view.js';
import './catalog.css';

// The squishy catalog (#14, design doc §21): every squishy the player has
// seen and befriended on this patch. A DOM sheet over the map (tech spec §6).

export interface CatalogScreenOptions {
  root: HTMLElement;
  api?: typeof catalogApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface CatalogDebug {
  readonly mapId: string;
  readonly loading: boolean;
  readonly seen: number;
  readonly caught: number;
  readonly total: number;
  /** Names on the cards, "???" for unseen ones. */
  readonly names: readonly string[];
}

export interface CatalogScreen {
  /** Shows the catalog for a patch and loads it. */
  show: (mapId: string) => void;
  close: () => void;
  setUser: (user: PublicUser | null) => void;
  readonly isOpen: boolean;
  readonly debug: CatalogDebug | null;
}

const UNSEEN = '???';

export function createCatalogScreen(options: CatalogScreenOptions): CatalogScreen {
  const api = options.api ?? catalogApi;
  let mapId: string | null = null;
  let page: CatalogPage | null = null;
  /** Bumped on every open/close, so a late reply for an old one is dropped. */
  let ticket = 0;

  const progress = el('p', { class: 'catalog-progress', 'data-testid': 'catalog-progress' });
  const grid = el('ul', { class: 'catalog-grid', 'data-testid': 'catalog-grid' });
  const problem = el('p', { class: 'auth-error', role: 'alert' });
  const close = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'catalog-close' },
    'Close',
  );
  close.addEventListener('click', () => {
    hide();
  });
  const panel = el(
    'section',
    {
      class: 'catalog',
      role: 'dialog',
      'aria-labelledby': 'catalog-title',
      'data-testid': 'catalog',
    },
    el(
      'div',
      { class: 'auth-card catalog-card' },
      el('h1', { class: 'auth-title', id: 'catalog-title' }, 'Squishy Catalog'),
      progress,
      grid,
      problem,
      el('div', { class: 'auth-actions' }, close),
    ),
  );
  panel.hidden = true;
  options.root.append(panel);

  const render = (next: CatalogPage): void => {
    page = next;
    progress.textContent = next.progress;
    grid.replaceChildren(
      ...next.cards.map((card) => {
        const blob = el('span', {
          class: card.seen ? 'catalog-blob' : 'catalog-blob catalog-blob-unseen',
          'aria-hidden': 'true',
        });
        if (card.color) blob.style.background = card.color;
        const badge = card.caught ? 'Friend ♥' : card.seen ? 'Seen' : '';
        return el(
          'li',
          {
            class: card.caught ? 'catalog-entry catalog-entry-caught' : 'catalog-entry',
            'data-testid': 'catalog-entry',
          },
          blob,
          el('span', { class: 'catalog-name' }, card.name ?? UNSEEN),
          el('span', { class: 'catalog-badge' }, badge),
        );
      }),
    );
  };

  function hide(): void {
    ticket += 1;
    mapId = null;
    page = null;
    panel.hidden = true;
  }

  return {
    show: (id) => {
      const mine = (ticket += 1);
      mapId = id;
      page = null;
      progress.textContent = 'Loading…';
      grid.replaceChildren();
      problem.textContent = '';
      panel.hidden = false;
      api
        .get(id)
        .then((catalog) => {
          if (mine === ticket) render(catalogPage(GAME_DATA.species, catalog));
        })
        .catch((err: unknown) => {
          if (mine !== ticket) return;
          progress.textContent = '';
          problem.textContent = messageOf(err);
        });
    },
    close: hide,
    setUser: () => {
      hide();
    },
    get isOpen() {
      return !panel.hidden;
    },
    get debug() {
      if (!mapId) return null;
      return {
        mapId,
        loading: page === null,
        seen: page?.seen ?? 0,
        caught: page?.caught ?? 0,
        total: page?.total ?? 0,
        names: page?.cards.map((c) => c.name ?? UNSEEN) ?? [],
      };
    },
  };
}
