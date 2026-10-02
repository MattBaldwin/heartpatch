import { el } from '../ui/dom.js';
import type { TileInfo } from './tile-info.js';

// The tile info panel: a bottom sheet over the map (tech spec §6, DOM overlay).
// Information only; actions like claiming arrive with their own issues, and
// home bases never get one (design doc §11).

export interface TilePanel {
  show: (info: TileInfo) => void;
  hide: () => void;
  readonly open: boolean;
}

export function mountTilePanel(root: HTMLElement, onClose: () => void): TilePanel {
  const title = el('h2', { class: 'tile-panel-title', id: 'tile-panel-title' });
  const owner = el('p', { class: 'tile-panel-owner', 'data-testid': 'tile-panel-owner' });
  const about = el('p', { class: 'tile-panel-about' });
  const resource = el('p', { class: 'tile-panel-resource' });
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
      panel.classList.toggle('tile-panel-home', info.home);
      panel.hidden = false;
    },
    hide: () => {
      panel.hidden = true;
    },
    get open() {
      return !panel.hidden;
    },
  };
}
