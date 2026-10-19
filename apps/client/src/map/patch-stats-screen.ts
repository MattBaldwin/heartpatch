import type { PatchStats } from '@heartpatch/shared';
import { el, messageOf } from '../ui/dom.js';
import { slotIcon } from './map-legend.js';
import { mapApi } from './map-api.js';
import { statsPage, type KeeperCard, type StatLine, type StatsPage } from './patch-stats-view.js';
import './patch-stats.css';

// Patch stats (#573): who's winning what, a crown per category. A DOM sheet
// over the map like the catalog (tech spec §6), opened from the legend card
// under the patch's name. The server works the numbers out (rule 1).

export interface PatchStatsScreen {
  /** Shows the stats for a patch and loads them, as `userId` sees them. */
  show: (mapId: string, userId: string | null) => void;
  close: () => void;
  readonly isOpen: boolean;
  /** The page on screen, for the dev hook; null while loading or shut. */
  readonly page: StatsPage | null;
}

export interface PatchStatsOptions {
  root: HTMLElement;
  api?: { stats: (mapId: string) => Promise<PatchStats> };
}

function statItem(line: StatLine, cls: string): HTMLElement {
  return el(
    'li',
    { class: cls },
    el('span', { class: 'patch-stats-emoji', 'aria-hidden': 'true' }, line.emoji),
    el('span', { class: 'patch-stats-label' }, line.label),
    el('span', { class: 'patch-stats-value' }, line.value),
  );
}

function keeperItem(card: KeeperCard): HTMLElement {
  const head = el(
    'div',
    { class: 'patch-stats-who' },
    ...(card.homeSlot === null ? [] : [slotIcon(card.homeSlot, 22)]),
    el('span', { class: 'patch-stats-name' }, card.name),
  );
  const crowns = el(
    'ul',
    { class: 'patch-stats-crowns', 'aria-label': 'Crowns' },
    ...card.crowns.map((c) =>
      el(
        'li',
        { class: 'patch-stats-crown', 'data-testid': 'patch-stats-crown' },
        `👑 ${c.emoji} ${c.label}`,
      ),
    ),
    ...(card.cheer ? [el('li', { class: 'patch-stats-cheer' }, card.cheer)] : []),
  );
  return el(
    'li',
    {
      class: card.mine ? 'patch-stats-keeper patch-stats-mine' : 'patch-stats-keeper',
      'data-testid': 'patch-stats-keeper',
    },
    head,
    crowns,
    el(
      'ul',
      { class: 'patch-stats-lines' },
      ...card.lines.map((l) => statItem(l, 'patch-stats-line')),
    ),
    el(
      'p',
      { class: 'patch-stats-buildings' },
      el('span', { 'aria-hidden': 'true' }, '🛠️ '),
      card.buildings.length > 0 ? card.buildings.join(' · ') : 'Nothing built yet',
    ),
  );
}

export function createPatchStatsScreen(options: PatchStatsOptions): PatchStatsScreen {
  const api = options.api ?? mapApi;
  let page: StatsPage | null = null;
  /** Bumped on every open/close, so a late reply for an old one is dropped. */
  let ticket = 0;

  const totals = el('ul', { class: 'patch-stats-totals', 'data-testid': 'patch-stats-totals' });
  const list = el('ul', { class: 'patch-stats-list' });
  const status = el('p', { class: 'patch-stats-status', role: 'status' });
  const problem = el('p', { class: 'auth-error', role: 'alert' });
  const closeTop = el(
    'button',
    {
      type: 'button',
      class: 'patch-stats-close-top',
      'aria-label': 'Close',
      'data-testid': 'patch-stats-close-top',
    },
    '×',
  );
  const close = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'patch-stats-close' },
    'Close',
  );
  const panel = el(
    'section',
    {
      class: 'patch-stats',
      role: 'dialog',
      'aria-labelledby': 'patch-stats-title',
      'data-testid': 'patch-stats',
    },
    el(
      'div',
      { class: 'auth-card patch-stats-card' },
      el(
        'div',
        { class: 'patch-stats-head' },
        el('h1', { class: 'auth-title patch-stats-title', id: 'patch-stats-title' }, 'Patch stats'),
        closeTop,
      ),
      el(
        'div',
        { class: 'patch-stats-scroll' },
        totals,
        status,
        list,
        problem,
        el('p', { class: 'patch-stats-footer' }, 'Every crown is up for grabs!'),
      ),
      el('div', { class: 'auth-actions patch-stats-actions' }, close),
    ),
  );
  panel.hidden = true;
  options.root.append(panel);

  function hide(): void {
    ticket += 1;
    page = null;
    panel.hidden = true;
  }
  close.addEventListener('click', hide);
  closeTop.addEventListener('click', hide);

  return {
    show: (mapId, userId) => {
      const mine = (ticket += 1);
      page = null;
      totals.replaceChildren();
      list.replaceChildren();
      status.textContent = 'Counting…';
      problem.textContent = '';
      panel.hidden = false;
      api
        .stats(mapId)
        .then((stats) => {
          if (mine !== ticket) return;
          page = statsPage(stats, userId);
          status.textContent = '';
          totals.replaceChildren(...page.totals.map((l) => statItem(l, 'patch-stats-total')));
          list.replaceChildren(...page.keepers.map(keeperItem));
        })
        .catch((err: unknown) => {
          if (mine !== ticket) return;
          status.textContent = '';
          problem.textContent = messageOf(err);
        });
    },
    close: hide,
    get isOpen() {
      return !panel.hidden;
    },
    get page() {
      return page;
    },
  };
}
