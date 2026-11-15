import { GAME_DATA, type PublicUser } from '@heartpatch/shared';
import { seasonsOn } from '../map/map-dressing.js';
import { deviceTimeZone, el, messageOf } from '../ui/dom.js';
import { rarityChip, rarityClass, rarityName } from '../ui/rarity/rarity.js';
import { catalogApi } from './catalog-api.js';
import { catalogPage, tierText, type CatalogPage } from './catalog-view.js';
import { hpClose } from '../ui/button/button.js';
import './catalog.css';

// The squishy catalog (#14, design doc §21): every squishy the player has
// seen and befriended on this patch. A DOM sheet over the map (tech spec §6).

export interface CatalogScreenOptions {
  root: HTMLElement;
  api?: typeof catalogApi;
  /** A befriended species was tapped: open the care sheet for one (#19). */
  onCare?: (mapId: string, speciesId: string) => void;
  /** The patch's time zone, for which seasonal kinds count today. Defaults to the device's. */
  timeZone?: (mapId: string) => string | null;
  /** The clock; tests pass their own. */
  now?: () => Date;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface CatalogDebug {
  readonly mapId: string;
  readonly loading: boolean;
  readonly seen: number;
  readonly caught: number;
  readonly total: number;
  /** The goal rows, as shown ("Common 9 of 30 friends"). */
  readonly tiers: readonly string[];
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

  const progress = el('ul', { class: 'catalog-goal', 'data-testid': 'catalog-progress' });
  const loading = el('p', { class: 'catalog-loading' });
  const grid = el('ul', { class: 'catalog-grid', 'data-testid': 'catalog-grid' });
  const problem = el('p', { class: 'auth-error', role: 'alert' });
  const close = el(
    'button',
    { type: 'button', class: 'hp-button hp-button-secondary', 'data-testid': 'catalog-close' },
    'Close',
  );
  close.addEventListener('click', () => {
    hide();
  });
  // An × up top too (#150): a long list shouldn't need scrolling to leave.
  const closeTop = hpClose('Close', 'catalog-close-top');
  closeTop.addEventListener('click', () => {
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
      el(
        'div',
        { class: 'catalog-head' },
        el('h1', { class: 'auth-title catalog-title', id: 'catalog-title' }, 'Squishy Catalog'),
        closeTop,
      ),
      progress,
      el('div', { class: 'catalog-scroll' }, loading, grid, problem),
      el('div', { class: 'auth-actions catalog-actions' }, close),
    ),
  );
  panel.hidden = true;
  options.root.append(panel);

  const render = (next: CatalogPage): void => {
    page = next;
    loading.textContent = '';
    progress.replaceChildren(
      ...next.tiers.map((tier) =>
        el(
          'li',
          {
            class: `catalog-tier ${rarityClass(tier.rarity)}${tier.done ? ' catalog-tier-done' : ''}${tier.current ? ' catalog-tier-current' : ''}`,
            'data-testid': 'catalog-tier',
            'data-rarity': tier.rarity,
          },
          rarityChip(tier.rarity),
          el('span', { class: 'catalog-tier-count' }, tierText(tier)),
          tier.done ? el('span', { class: 'catalog-tier-check', 'aria-hidden': 'true' }, '✓') : '',
        ),
      ),
    );
    grid.replaceChildren(
      ...next.cards.map((card) => {
        const blob = el('span', {
          class: card.seen ? 'catalog-blob' : 'catalog-blob catalog-blob-unseen',
          'aria-hidden': 'true',
        });
        if (card.color) blob.style.background = card.color;
        const badge = card.caught ? 'Friend ♥' : card.seen ? 'Seen' : '';
        const parts = [
          blob,
          el('span', { class: 'catalog-name' }, card.name ?? UNSEEN),
          // Unseen cards keep a blank space, so the cards line up (#240).
          card.rarity
            ? rarityChip(card.rarity)
            : el('span', { class: 'catalog-rarity-gap', 'aria-hidden': 'true' }),
          el('span', { class: 'catalog-badge' }, badge),
        ];
        const careFor = options.onCare;
        let content: Node[] = parts;
        // A friend's card opens its care sheet (#19).
        if (card.caught && careFor) {
          const open = el(
            'button',
            { type: 'button', class: 'catalog-care', 'data-care-species': card.speciesId },
            ...parts,
          );
          open.addEventListener('click', () => {
            if (mapId) careFor(mapId, card.speciesId);
          });
          content = [open];
        }
        return el(
          'li',
          {
            class: card.caught ? 'catalog-entry catalog-entry-caught' : 'catalog-entry',
            'data-testid': 'catalog-entry',
          },
          ...content,
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
      progress.replaceChildren();
      loading.textContent = 'Loading…';
      grid.replaceChildren();
      problem.textContent = '';
      panel.hidden = false;
      api
        .get(id)
        .then((catalog) => {
          if (mine === ticket)
            render(
              catalogPage(
                GAME_DATA.species,
                catalog,
                seasonsOn(
                  options.timeZone?.(id) ?? deviceTimeZone(),
                  options.now?.() ?? new Date(),
                ),
              ),
            );
        })
        .catch((err: unknown) => {
          if (mine !== ticket) return;
          loading.textContent = '';
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
        tiers: page?.tiers.map((t) => `${rarityName(t.rarity)} ${tierText(t)}`) ?? [],
        names: page?.cards.map((c) => c.name ?? UNSEEN) ?? [],
      };
    },
  };
}
