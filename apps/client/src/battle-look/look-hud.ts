import { el } from '../ui/dom.js';
import type { Direction } from './directions.js';
import type { SheetMode } from './shots.js';
import './battle-look.css';

/*
 * The HUD for the look prototypes (tech spec §6: a DOM overlay for sharp
 * text and big targets). Compact by rule: small name and energy pills in the
 * top corners, actions in a bottom sheet of at most 35% of the screen height
 * with 44pt targets, nothing over the fighters. Three skins (CSS by
 * `data-skin`): storybook, comic, glass. Words follow docs/STYLE_GUIDE.md.
 */

export interface PillInfo {
  name: string;
  level: number;
  element: string;
  feeling: string;
  /** 0–1. */
  energy: number;
}

export interface LookHud {
  setPills(mine: PillInfo, theirs: PillInfo): void;
  setSheet(mode: SheetMode, caption: string, moves: string[]): void;
  callout(side: 'mine' | 'theirs', text: string): void;
  /** The safe region for the fight, as fractions of the screen height from the top. */
  safe(): { top: number; bottom: number };
  dispose(): void;
}

const ELEMENT_EMOJI: Record<string, string> = {
  fire: '🔥',
  water: '💧',
  leaf: '🍃',
  frost: '❄️',
  spark: '⚡',
  stone: '🪨',
  shadow: '🌙',
  light: '✨',
};
const FEELING_EMOJI: Record<string, string> = {
  joy: '😄',
  cozy: '☺️',
  brave: '😤',
  silly: '🤪',
  sleepy: '😴',
  spooky: '👻',
};

export function mountLookHud(root: HTMLElement, direction: Direction): LookHud {
  const pill = (side: 'mine' | 'theirs') => {
    const name = el('span', { class: 'bl-name' });
    const level = el('span', { class: 'bl-level' });
    const badges = el('span', { class: 'bl-badges' });
    const fill = el('div', { class: 'bl-energy-fill' });
    const energy = el('div', { class: 'bl-energy', role: 'progressbar', 'aria-label': 'Energy' }, fill);
    const callout = el('span', { class: 'bl-callout' });
    const node = el(
      'div',
      { class: `bl-pill bl-${side}` },
      el('div', { class: 'bl-pill-row' }, name, level),
      el('div', { class: 'bl-pill-row' }, energy, badges),
      callout,
    );
    return { node, name, level, badges, fill, callout, energy };
  };
  const pills = { mine: pill('mine'), theirs: pill('theirs') };
  const caption = el('p', { class: 'bl-caption' });
  const actions = el('div', { class: 'bl-actions' });
  const sheet = el('section', { class: 'bl-sheet' }, caption, actions);
  const hud = el(
    'section',
    { class: 'bl-hud', 'data-skin': direction.hud, 'aria-label': 'Squishy showdown' },
    el('div', { class: 'bl-top' }, pills.mine.node, pills.theirs.node),
    sheet,
  );
  root.append(hud);

  const button = (label: string, cls = '') =>
    el('button', { type: 'button', class: `bl-button ${cls}`.trim() }, label);

  return {
    setPills(mine, theirs) {
      for (const [side, info] of [
        ['mine', mine],
        ['theirs', theirs],
      ] as const) {
        const p = pills[side];
        p.name.textContent = info.name;
        p.level.textContent = `Lv ${String(info.level)}`;
        p.badges.replaceChildren(
          el('span', { class: 'bl-badge', 'data-element': info.element, title: info.element }, ELEMENT_EMOJI[info.element] ?? '✨'),
          el('span', { class: 'bl-badge bl-feeling', title: info.feeling }, FEELING_EMOJI[info.feeling] ?? '☺️'),
        );
        p.fill.style.width = `${String(Math.round(info.energy * 100))}%`;
        p.energy.dataset['low'] = info.energy <= 0.25 ? 'true' : 'false';
        p.node.classList.toggle('bl-tuckered', info.energy <= 0);
      }
    },
    setSheet(mode, text, moves) {
      caption.textContent = text;
      actions.replaceChildren();
      sheet.dataset['mode'] = mode;
      if (mode === 'choose') {
        const grid = el('div', { class: 'bl-moves' });
        for (const m of moves) grid.append(button(m, 'bl-move'));
        const row = el(
          'div',
          { class: 'bl-row' },
          button('💗 Heart Charm ×3', 'bl-small'),
          button('Swap', 'bl-small bl-soft'),
          button('Scoot', 'bl-small bl-soft'),
        );
        actions.append(grid, row);
      }
    },
    callout(side, text) {
      const p = pills[side];
      p.callout.textContent = text;
      p.callout.classList.add('bl-callout-show');
    },
    safe() {
      const h = window.innerHeight || 1;
      const pillBottom = Math.max(
        pills.mine.node.getBoundingClientRect().bottom,
        pills.theirs.node.getBoundingClientRect().bottom,
      );
      // The sheet's full height (35%) is reserved even when only the caption shows,
      // so the fight never jumps when the moves appear.
      const sheetTop = h * 0.65;
      return { top: (pillBottom + 10) / h, bottom: sheetTop / h };
    },
    dispose() {
      hud.remove();
    },
  };
}
