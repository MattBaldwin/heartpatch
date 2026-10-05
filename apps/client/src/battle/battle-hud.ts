import { ELEMENTS, FEELINGS, type BattleSideId, type PlayerBattleAction } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import type { SafeRegion } from './camera-director.js';
import { charmButton, noCharmsLine } from './heart-charm.js';
import './battle.css';

// The battle HUD (tech spec §6: a DOM overlay for sharp text and big
// targets; owner decision 2026-10-05: the Storybook Diorama's HUD): compact
// name and energy pills in the top corners, each over its own squishy, the
// caption and the moves in a bottom sheet of at most 35% of the screen, and
// nothing over the fighters. Comic callouts ("Super cozy!") pop under a pill.
// Words follow docs/STYLE_GUIDE.md: energy, tuckered out, never hurt.

export interface PlateInfo {
  name: string;
  level: number;
  element: string;
  feeling: string;
  /** 0–100. */
  percent: number;
  energyText: string;
  status: string | null;
}

export type ControlMode =
  /** The player picks a move or swaps. */
  | {
      type: 'choose';
      moves: { id: string; name: string }[];
      bench: { slot: number; name: string }[];
      /**
       * A wild squishy: the "Use Heart Charm" button (befriend, style guide §9),
       * always shown with the bag's count (null while it loads); null elsewhere.
       */
      capture: { charms: number | null } | null;
    }
  /** Their squishy is tuckered out: pick who comes out. */
  | { type: 'replace'; bench: { slot: number; name: string }[] }
  /** The log is playing, or the server is thinking. */
  | { type: 'waiting' }
  | { type: 'hidden' };

export interface ResultInfo {
  title: string;
  subtitle: string;
  /** "Moonpuff earned 12 XP" lines. */
  xp: string[];
  /** One extra hint line ("Weaken a wild squishy, then…"), if any. */
  nudge?: string;
  done: string;
}

export interface BattleHud {
  show: () => void;
  hide: () => void;
  setPlate: (side: 'mine' | 'theirs', info: PlateInfo) => void;
  setCaption: (text: string | null) => void;
  /** A comic callout ("Super cozy!") under a side's pill. */
  callout: (side: 'mine' | 'theirs', text: string) => void;
  setControls: (mode: ControlMode) => void;
  /** A friendly problem line under the controls (empty to clear). */
  setProblem: (text: string) => void;
  showResult: (info: ResultInfo) => void;
  hideResult: () => void;
  /** Where the fight may be drawn: under the pills, above the sheet (fractions of the height). */
  safe: () => SafeRegion;
  readonly visible: boolean;
  dispose: () => void;
}

export interface BattleHudOptions {
  onAction: (action: PlayerBattleAction) => void;
  onDone: () => void;
  onLeave: () => void;
  /**
   * The Heart Charm button was tapped with none in the bag (as far as the
   * HUD knows): the screen checks the bag again and explains or goes ahead.
   */
  onNoCharms: () => void;
}

/** Which side a plate shows, for the dev hook and tests. */
export const plateSideOf = (mySide: BattleSideId, side: BattleSideId): 'mine' | 'theirs' =>
  side === mySide ? 'mine' : 'theirs';

const CALLOUT_MS = 1100; // TUNE: long enough to read "Super cozy!"

/** The sheet's share of the screen is reserved even while only the caption shows, so the fight never jumps. */
export const SHEET_SHARE = 0.35;

/** Little badges for an element and a feeling (vector-free glyphs the system renders crisply). */
const ELEMENT_GLYPH: Readonly<Record<string, string>> = {
  fire: '🔥',
  water: '💧',
  leaf: '🍃',
  frost: '❄️',
  spark: '⚡',
  stone: '🪨',
  shadow: '🌙',
  light: '✨',
};
const FEELING_GLYPH: Readonly<Record<string, string>> = {
  joy: '😄',
  cozy: '☺️',
  brave: '😤',
  silly: '🤪',
  sleepy: '😴',
  spooky: '👻',
};
const ELEMENT_NAMES = new Map<string, string>(ELEMENTS.map((e) => [e.id, e.name]));
const FEELING_NAMES = new Map<string, string>(FEELINGS.map((f) => [f.id, f.name]));

export function mountBattleHud(root: HTMLElement, options: BattleHudOptions): BattleHud {
  const plate = (side: 'mine' | 'theirs') => {
    const name = el('span', { class: 'battle-plate-name' });
    const level = el('span', { class: 'battle-plate-level' });
    const bar = el('div', { class: 'battle-energy-fill' });
    const energy = el('span', {
      class: 'battle-plate-energy',
      'data-testid': `battle-energy-${side}`,
    });
    const element = el('span', { class: 'battle-badge' });
    const feeling = el('span', { class: 'battle-badge' });
    const status = el('span', { class: 'battle-plate-status' });
    const callout = el('span', { class: 'battle-callout', role: 'status' });
    const node = el(
      'div',
      { class: `battle-plate battle-plate-${side}`, 'data-testid': `battle-plate-${side}` },
      el('div', { class: 'battle-plate-row' }, name),
      el(
        'div',
        { class: 'battle-plate-row' },
        el('div', { class: 'battle-energy', role: 'progressbar', 'aria-label': 'Energy' }, bar),
        el('span', { class: 'battle-badges' }, element, feeling),
      ),
      el('div', { class: 'battle-plate-row battle-plate-foot' }, level, energy, status),
      callout,
    );
    return { node, name, level, bar, energy, element, feeling, status, callout, timer: 0 };
  };
  const plates = { mine: plate('mine'), theirs: plate('theirs') };

  const caption = el('p', {
    class: 'battle-caption',
    role: 'status',
    'data-testid': 'battle-caption',
  });
  const problem = el('p', { class: 'auth-error battle-problem', role: 'alert' });
  const controls = el('div', { class: 'battle-controls', 'data-testid': 'battle-controls' });
  const leave = el(
    'button',
    { type: 'button', class: 'battle-leave', 'aria-label': 'Back to patch' },
    '×',
  );
  leave.addEventListener('click', options.onLeave);

  const result = el('section', {
    class: 'battle-result auth-card',
    role: 'dialog',
    'aria-labelledby': 'battle-result-title',
    'data-testid': 'battle-result',
  });
  result.hidden = true;

  const top = el('div', { class: 'battle-top' }, plates.mine.node, leave, plates.theirs.node);
  const sheet = el(
    'section',
    { class: 'battle-sheet', 'data-testid': 'battle-sheet' },
    caption,
    controls,
    problem,
  );
  const hud = el(
    'section',
    { class: 'battle-hud', 'data-testid': 'battle-hud', 'aria-label': 'Squishy showdown' },
    top,
    sheet,
    result,
  );
  hud.hidden = true;
  root.append(hud);

  // The safe region is measured at most once per layout change, not per frame.
  let safe: SafeRegion | null = null;
  const forget = () => {
    safe = null;
  };
  window.addEventListener('resize', forget);

  const button = (
    label: string,
    onClick: () => void,
    extra: { soft?: boolean; testId?: string; small?: boolean } = {},
  ) => {
    const classes = ['battle-button'];
    if (extra.soft) classes.push('battle-button-soft');
    if (extra.small) classes.push('battle-button-small');
    const node = el(
      'button',
      {
        type: 'button',
        class: classes.join(' '),
        ...(extra.testId ? { 'data-testid': extra.testId } : {}),
      },
      label,
    );
    node.addEventListener('click', onClick);
    return node;
  };

  const act = (action: PlayerBattleAction) => {
    problem.textContent = '';
    options.onAction(action);
  };

  const setControls = (mode: ControlMode): void => {
    controls.replaceChildren();
    controls.hidden = mode.type === 'hidden';
    sheet.dataset['mode'] = mode.type;
    switch (mode.type) {
      case 'choose': {
        const moves = el('div', { class: 'battle-moves' });
        for (const move of mode.moves) {
          moves.append(
            button(
              move.name,
              () => {
                act({ type: 'move', move: move.id });
              },
              { testId: 'battle-move' },
            ),
          );
        }
        const row = el('div', { class: 'battle-row' });
        let hint: HTMLElement | null = null;
        if (mode.capture) {
          // Always there in a wild battle, so a player learns befriending
          // exists; with none in the bag it stays, dimmed, and explains.
          const charm = charmButton(mode.capture.charms);
          const node = button(
            charm.label,
            () => {
              if (charm.empty) options.onNoCharms();
              else act({ type: 'capture' });
            },
            { small: true, testId: 'battle-capture' },
          );
          if (charm.empty) {
            node.classList.add('battle-button-empty');
            // Still tappable (not `disabled`): a tap explains, and checks the bag again.
            hint = el(
              'p',
              { class: 'battle-hint', 'data-testid': 'battle-capture-hint' },
              noCharmsLine(),
            );
            node.setAttribute('aria-describedby', 'battle-capture-hint');
            hint.id = 'battle-capture-hint';
          }
          row.append(node);
        }
        for (const { slot, name } of mode.bench) {
          row.append(
            button(
              `Swap: ${name}`,
              () => {
                act({ type: 'swap', slot });
              },
              { soft: true, small: true, testId: 'battle-swap' },
            ),
          );
        }
        // Forgiving (style guide §3): running away asks first.
        const run = button(
          'Run away',
          () => {
            controls.replaceChildren(
              el('p', { class: 'battle-ask' }, 'Scoot away from this one?'),
              el(
                'div',
                { class: 'battle-row' },
                button(
                  'Yes, scoot!',
                  () => {
                    act({ type: 'forfeit' });
                  },
                  { small: true, testId: 'battle-run-confirm' },
                ),
                button(
                  'Stay and play',
                  () => {
                    setControls(mode);
                  },
                  { soft: true, small: true },
                ),
              ),
            );
          },
          { soft: true, small: true, testId: 'battle-run' },
        );
        row.append(run);
        controls.append(moves, row);
        if (hint) controls.append(hint);
        break;
      }
      case 'replace': {
        controls.append(el('p', { class: 'battle-ask' }, 'Who comes out next?'));
        const row = el('div', { class: 'battle-moves' });
        for (const { slot, name } of mode.bench) {
          row.append(
            button(
              name,
              () => {
                act({ type: 'replace', slot });
              },
              { testId: 'battle-replace' },
            ),
          );
        }
        controls.append(row);
        break;
      }
      case 'waiting':
        controls.append(el('p', { class: 'battle-ask battle-waiting' }, '…'));
        break;
      case 'hidden':
        break;
    }
  };

  return {
    show: () => {
      hud.hidden = false;
      forget();
    },
    hide: () => {
      hud.hidden = true;
      result.hidden = true;
    },
    setPlate: (side, info) => {
      const p = plates[side];
      p.name.textContent = info.name;
      p.level.textContent = `Lv ${String(info.level)}`;
      p.bar.style.width = `${String(info.percent)}%`;
      p.bar.classList.toggle('battle-energy-low', info.percent <= 25);
      p.energy.textContent = info.energyText;
      p.energy.setAttribute('aria-label', `${info.energyText} energy`);
      p.element.textContent = ELEMENT_GLYPH[info.element] ?? '✨';
      p.element.title = ELEMENT_NAMES.get(info.element) ?? info.element;
      p.element.setAttribute('aria-label', p.element.title);
      p.feeling.textContent = FEELING_GLYPH[info.feeling] ?? '☺️';
      p.feeling.title = FEELING_NAMES.get(info.feeling) ?? info.feeling;
      p.feeling.setAttribute('aria-label', p.feeling.title);
      p.status.textContent = info.status ?? '';
      p.status.hidden = info.status === null;
      p.node.classList.toggle('battle-plate-tuckered', info.percent === 0);
    },
    setCaption: (text) => {
      caption.textContent = text ?? '';
      caption.hidden = text === null;
    },
    callout: (side, text) => {
      const p = plates[side];
      p.callout.textContent = text;
      // Restart the pop animation even if the same text shows twice in a row.
      p.callout.classList.remove('battle-callout-show');
      for (const animation of p.callout.getAnimations()) animation.cancel();
      requestAnimationFrame(() => {
        p.callout.classList.add('battle-callout-show');
      });
      window.clearTimeout(p.timer);
      p.timer = window.setTimeout(() => {
        p.callout.classList.remove('battle-callout-show');
      }, CALLOUT_MS);
    },
    setControls,
    setProblem: (text) => {
      problem.textContent = text;
    },
    showResult: (info) => {
      result.replaceChildren(
        el('h1', { class: 'auth-title', id: 'battle-result-title' }, info.title),
        el('p', { class: 'auth-subtitle' }, info.subtitle),
        el(
          'ul',
          { class: 'battle-xp', 'data-testid': 'battle-xp' },
          ...info.xp.map((line) => el('li', {}, line)),
        ),
        ...(info.nudge
          ? [el('p', { class: 'battle-hint', 'data-testid': 'battle-nudge' }, info.nudge)]
          : []),
        el(
          'div',
          { class: 'auth-actions' },
          button(info.done, options.onDone, { testId: 'battle-done' }),
        ),
      );
      result.hidden = false;
      controls.hidden = true;
    },
    hideResult: () => {
      result.hidden = true;
    },
    safe: () => {
      if (safe) return safe;
      const h = window.innerHeight || 1;
      const pillBottom = Math.max(
        plates.mine.node.getBoundingClientRect().bottom,
        plates.theirs.node.getBoundingClientRect().bottom,
      );
      // The pills aren't laid out yet (hidden): a sensible guess until they are.
      const top = pillBottom > 0 ? (pillBottom + 10) / h : 0.14;
      safe = { top: Math.min(0.4, top), bottom: 1 - SHEET_SHARE };
      return safe;
    },
    get visible() {
      return !hud.hidden;
    },
    dispose: () => {
      window.removeEventListener('resize', forget);
      for (const p of Object.values(plates)) window.clearTimeout(p.timer);
      hud.remove();
    },
  };
}
