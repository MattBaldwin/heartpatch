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
  openKeyMap(c: HollowedCluster): void;
  openHomeName(keeperName: string, onNamed: (name: string) => void): void;
  close(): void;
  readonly open: 'restore' | 'rename' | 'keymap' | 'homename' | null;
}

/** The mockup's broken buildings on the doorstep tile and their pieces. TUNE. */
const PIECES = [
  { what: '🪵 Timber', need: 6, have: 14 },
  { what: '🪨 Stone', need: 4, have: 9 },
  { what: '💗 Heartdust', need: 1, have: 3 },
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
  let open: 'restore' | 'rename' | 'keymap' | 'homename' | null = null;

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
      // Owner decision 2026-10-18: kids type the name (server text filter); the
      // three generated names are tap-to-fill suggestions.
      const names = [c.restoredName, 'Bramblewick Meadow', 'Lanternlight Glen'];
      const input = el('input', {
        type: 'text',
        class: 'hollowed-input',
        id: 'hollowed-name',
        maxlength: '24',
        placeholder: 'Type a name…',
        autocomplete: 'off',
        'data-testid': 'hollowed-name-input',
      }) as HTMLInputElement;
      input.value = c.restoredName;
      const chips = names.map((name) => {
        const b = el('button', { type: 'button', class: 'hollowed-chip' }, name);
        b.addEventListener('click', () => {
          input.value = name;
          input.focus();
        });
        return b;
      });
      sheet.replaceChildren(
        el('p', { class: 'explore-card-progress' }, `${c.name.toUpperCase()} · 5 of 5 restored ✨`),
        el('h3', { class: 'explore-sheet-title', id: 'hollowed-sheet-title' }, 'The joy is back! 🌈'),
        el('p', { class: 'explore-card-line' }, 'You brought this village back to life. What will you call it?'),
        el('label', { class: 'hollowed-label', for: 'hollowed-name' }, 'Its new name'),
        input,
        el('div', { class: 'hollowed-chips', role: 'group', 'aria-label': 'Name ideas' }, ...chips),
        el('p', { class: 'hollowed-note' }, 'Tap an idea, or type your own. Names are checked to keep the patch kind.'),
        el('button', { type: 'button', class: 'auth-button hollowed-primary', 'data-testid': 'hollowed-name-it' }, 'Name it! ✨'),
      );
      sheet.querySelector('[data-testid="hollowed-name-it"]')?.addEventListener('click', close);
      sheet.hidden = false;
    },
    openKeyMap: (c) => {
      open = 'keymap';
      sheet.replaceChildren(
        el('p', { class: 'explore-card-progress' }, `${c.restoredName.toUpperCase()} · RESTORED`),
        el('h3', { class: 'explore-sheet-title', id: 'hollowed-sheet-title' }, 'A map to the key! 🗺️'),
        el(
          'p',
          { class: 'explore-card-line' },
          'The village squishies hid the cellar key from the Hollow Man. The map shows the tile where they tucked it away.',
        ),
        el('div', { class: 'hollowed-map' }, el('span', { class: 'hollowed-map-x' }, '✕'), el('span', { class: 'hollowed-map-home' }, '🏡')),
        el('p', { class: 'hollowed-note' }, 'Find the squishies there and they will hand it over. Then the cellar is yours to open 🔑'),
        el('button', { type: 'button', class: 'auth-button hollowed-primary', 'data-testid': 'hollowed-key-go' }, 'Show me on the map'),
      );
      sheet.querySelector('[data-testid="hollowed-key-go"]')?.addEventListener('click', close);
      sheet.hidden = false;
    },
    openHomeName: (keeperName, onNamed) => {
      open = 'homename';
      // Owner decision 2026-10-18: any kid names their home from day one.
      const ideas = [`${keeperName}'s Meadow`, 'Puddle Corner', 'Sunny Patch'];
      const input = el('input', {
        type: 'text',
        class: 'hollowed-input',
        id: 'hollowed-home-name',
        maxlength: '16',
        placeholder: 'Type a name…',
        autocomplete: 'off',
        'data-testid': 'hollowed-name-input',
      }) as HTMLInputElement;
      input.value = ideas[0] ?? '';
      const chips = ideas.map((name) => {
        const b = el('button', { type: 'button', class: 'hollowed-chip' }, name);
        b.addEventListener('click', () => {
          input.value = name;
          input.focus();
        });
        return b;
      });
      const go = el('button', { type: 'button', class: 'auth-button hollowed-primary', 'data-testid': 'hollowed-name-it' }, 'Name it! 🏡');
      go.addEventListener('click', () => {
        onNamed(input.value.trim());
        close();
      });
      sheet.replaceChildren(
        el('p', { class: 'explore-card-progress' }, 'YOUR HOME'),
        el('h3', { class: 'explore-sheet-title', id: 'hollowed-sheet-title' }, 'Name your home 🏡'),
        el('p', { class: 'explore-card-line' }, 'Every Keeper\'s home has a name. What\'s yours called?'),
        el('label', { class: 'hollowed-label', for: 'hollowed-home-name' }, 'Home name'),
        input,
        el('div', { class: 'hollowed-chips', role: 'group', 'aria-label': 'Name ideas' }, ...chips),
        el('p', { class: 'hollowed-note' }, 'Tap an idea, or type your own. Up to 16 letters; you can rename it once a day.'),
        go,
      );
      sheet.hidden = false;
    },
    close,
    get open() {
      return open;
    },
  };
}
