import { el } from '../ui/dom.js';
import type { TileInfo } from './tile-info.js';

// The tile chip: a compact card at the bottom of the map when a tile is
// tapped (tech spec §6, DOM overlay; owner decision 2026-10-04: the world
// stays immersive). The name, who it belongs to, its guardians, and the 1–3
// actions features put in its slot (gathering #17, home #18, territory #15).
// The longer words (what the land is like, what grows there) fold behind an
// (i) button. Home bases never offer Claim (design doc §11).

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
  const details = el(
    'div',
    { class: 'tile-panel-details', id: 'tile-panel-details', 'data-testid': 'tile-panel-details' },
    about,
    resource,
  );
  details.hidden = true;
  const info = el(
    'button',
    {
      type: 'button',
      class: 'tile-panel-info',
      'aria-label': 'More about this land',
      'aria-controls': 'tile-panel-details',
      'aria-expanded': 'false',
      'data-testid': 'tile-panel-info',
    },
    'i',
  );
  const setDetails = (open: boolean) => {
    details.hidden = !open;
    info.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  info.addEventListener('click', () => {
    setDetails(info.getAttribute('aria-expanded') !== 'true');
  });
  const guardians = el('p', {
    class: 'tile-panel-guardians',
    'data-testid': 'tile-panel-guardians',
  });
  // What a squishy gatherer picks here (#238), out on the card, not folded away.
  const gatherer = el('p', {
    class: 'tile-panel-gatherer',
    'data-testid': 'tile-panel-gatherer',
  });
  // A trading post (#269): how I reach it.
  const postReachText = el('p', { class: 'tile-panel-post', 'data-testid': 'tile-panel-post' });
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
    el(
      'div',
      { class: 'tile-panel-head' },
      el('div', { class: 'tile-panel-names' }, title, owner),
      info,
      close,
    ),
    guardians,
    gatherer,
    postReachText,
    details,
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
      gatherer.textContent = info.gatherer ?? '';
      gatherer.hidden = info.gatherer === null;
      postReachText.textContent = info.post?.reach ?? '';
      postReachText.hidden = !info.post?.reach;
      panel.classList.toggle('tile-panel-home', info.home);
      panel.classList.toggle('tile-panel-trading-post', info.post !== null);
      panel.hidden = false;
    },
    hide: () => {
      panel.hidden = true;
      setDetails(false);
    },
    get open() {
      return !panel.hidden;
    },
    actions,
  };
}
