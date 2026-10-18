import { el } from '../ui/dom.js';
import { restoredLine, type HollowedCluster } from './hollowed-preview.js';
import './hollowed.css';

/*
 * PROTOTYPE (#306 plan): the restore sheet and the claim-and-rename card,
 * built on explore's big-moment card (`.explore-sheet`). Words follow
 * STYLE_GUIDE (short, warm, kid-readable). Numbers are the plan's first
 * guesses (`// TUNE:` in the plan's data tables).
 */

export interface HollowedSheets {
  openRestore(c: HollowedCluster): void;
  openRename(c: HollowedCluster): void;
  close(): void;
  readonly open: 'restore' | 'rename' | null;
}

/** The mockup's broken buildings on the doorstep tile and their pieces. TUNE. */
const PIECES = [
  { what: '🪵 Timber', need: 6, have: 14 },
  { what: '🪨 Stone', need: 4, have: 9 },
  { what: '💗 Heartdust', need: 2, have: 3 },
];

export function mountHollowedSheets(root: HTMLElement): HollowedSheets {
  const sheet = el('section', {
    class: 'explore-sheet hollowed-sheet',
    role: 'dialog',
    'aria-labelledby': 'hollowed-sheet-title',
    'data-testid': 'hollowed-sheet',
  });
  sheet.hidden = true;
  root.append(sheet);
  let open: 'restore' | 'rename' | null = null;

  const close = () => {
    open = null;
    sheet.hidden = true;
    sheet.replaceChildren();
  };

  const meter = (done: number, total: number) =>
    el(
      'div',
      { class: 'hollowed-meter', 'aria-label': `${String(done)} of ${String(total)} pieces` },
      ...Array.from({ length: total }, (_, i) => el('span', { class: i < done ? 'on' : '' })),
    );

  return {
    openRestore: (c) => {
      open = 'restore';
      sheet.replaceChildren(
        el('p', { class: 'explore-card-progress' }, `${c.name.toUpperCase()} · ${restoredLine(c)}`),
        el('h3', { class: 'explore-sheet-title', id: 'hollowed-sheet-title' }, 'Restore the Old Well 🪣'),
        el('p', { class: 'explore-card-line' }, 'Pieces put back: 2 of 4'),
        meter(2, 4),
        el(
          'ul',
          { class: 'hollowed-rows', 'data-testid': 'hollowed-costs' },
          el('li', { class: 'hollowed-row hollowed-row-done' }, el('span', {}, 'Mia put back 2 pieces'), el('span', {}, '✓')),
          ...PIECES.map((p) =>
            el(
              'li',
              { class: 'hollowed-row' },
              el('span', {}, `${p.what} × ${String(p.need)}`),
              el('span', { class: 'hollowed-row-have' }, `you have ${String(p.have)}`),
            ),
          ),
        ),
        el(
          'p',
          { class: 'hollowed-note' },
          'Helpers get a thank-you gift 🎁 Whoever adds the last piece claims this tile!',
        ),
        el('button', { type: 'button', class: 'auth-button hollowed-primary', 'data-testid': 'hollowed-restore' }, 'Restore a piece 🛠️'),
        el('button', { type: 'button', class: 'auth-button auth-button-soft hollowed-soft', 'data-testid': 'hollowed-not-now' }, 'Not now'),
      );
      sheet.querySelector('[data-testid="hollowed-not-now"]')?.addEventListener('click', close);
      sheet.hidden = false;
    },
    openRename: (c) => {
      open = 'rename';
      const names = [c.restoredName, 'Bramblewick Meadow', 'Lanternlight Glen'];
      let picked = 0;
      const options = names.map((name, i) =>
        el('button', { type: 'button', class: 'hollowed-name', role: 'radio', 'aria-checked': i === picked ? 'true' : 'false' }, name),
      );
      options.forEach((b, i) =>
        b.addEventListener('click', () => {
          picked = i;
          options.forEach((o, j) => o.setAttribute('aria-checked', j === picked ? 'true' : 'false'));
        }),
      );
      sheet.replaceChildren(
        el('p', { class: 'explore-card-progress' }, `${c.name.toUpperCase()} · 5 of 5 restored ✨`),
        el('h3', { class: 'explore-sheet-title', id: 'hollowed-sheet-title' }, 'The joy is back! 🌈'),
        el('p', { class: 'explore-card-line' }, 'You brought this whole village back to life. Pick its new name:'),
        el('div', { class: 'hollowed-names', role: 'radiogroup' }, ...options),
        el('button', { type: 'button', class: 'auth-button auth-button-soft hollowed-soft' }, '🎲 Other names'),
        el('button', { type: 'button', class: 'auth-button hollowed-primary', 'data-testid': 'hollowed-name-it' }, 'Name it! ✨'),
      );
      sheet.querySelector('[data-testid="hollowed-name-it"]')?.addEventListener('click', close);
      sheet.hidden = false;
    },
    close,
    get open() {
      return open;
    },
  };
}
