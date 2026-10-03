import { el } from '../ui/dom.js';
import type { TileInfo } from './tile-info.js';

// The tile info panel: a bottom sheet over the map (tech spec §6, DOM overlay).
// Information, plus an actions slot other features fill (gathering, #17).
// Claiming arrives with its own issue, and home bases never offer it (design
// doc §11).

export interface TilePanel {
  show: (info: TileInfo) => void;
  hide: () => void;
  readonly open: boolean;
  /** Where features draw their buttons for the tile on show. */
  readonly actions: HTMLElement;
}

export function mountTilePanel(root: HTMLElement, onClose: () => void): TilePanel {
  const title = el('h2', { class: 'tile-panel-title', id: 'tile-panel-title' });
  const owner = el('p', { class: 'tile-panel-owner', 'data-testid': 'tile-panel-owner' });
  const about = el('p', { class: 'tile-panel-about' });
  const resource = el('p', { class: 'tile-panel-resource' });
  const guardians = el('p', {
    class: 'tile-panel-guardians',
    'data-testid': 'tile-panel-guardians',
  });
  const actions = el('div', { class: 'tile-panel-actions', 'data-testid': 'tile-panel-actions' });
  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': 'Close' },
    '×',
  );
  close.addEventListener('click', onClose);
  const panel = el(
    'section',
    {
      class: 'tile-panel',
      'data-testid': 'tile-panel',
      role: 'dialog',
      'aria-labelledby': 'tile-panel-title',
    },
    el('div', { class: 'tile-panel-head' }, title, close),
    owner,
    about,
    resource,
    guardians,
    actions,
  );
  panel.hidden = true;
  root.append(panel);

  return {
    show: (info) => {
      title.textContent = info.title;
      owner.textContent = info.owner;
      about.textContent = info.about;
      resource.textContent = info.resource ?? '';
      resource.hidden = info.resource === null;
      guardians.textContent = info.guardians ?? '';
      guardians.hidden = info.guardians === null;
      panel.classList.toggle('tile-panel-home', info.home);
      panel.hidden = false;
    },
    hide: () => {
      panel.hidden = true;
    },
    get open() {
      return !panel.hidden;
    },
    actions,
  };
}
