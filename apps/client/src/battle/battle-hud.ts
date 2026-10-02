import type { BattleSideId, PlayerBattleAction } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import './battle.css';

// The battle HUD (tech spec §6: DOM overlay for sharp text and big targets):
// two energy bars, a caption, callouts, the move buttons, and the result card.
// Words follow docs/STYLE_GUIDE.md: energy, tuckered out, never hurt.

export interface PlateInfo {
  name: string;
  nature: string;
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
  done: string;
}

export interface BattleHud {
  show: () => void;
  hide: () => void;
  setPlate: (side: 'mine' | 'theirs', info: PlateInfo) => void;
  setCaption: (text: string | null) => void;
  /** A floating callout ("Super cozy!") over a side's plate. */
  callout: (side: 'mine' | 'theirs', text: string) => void;
  setControls: (mode: ControlMode) => void;
  /** A friendly problem line under the controls (empty to clear). */
  setProblem: (text: string) => void;
  showResult: (info: ResultInfo) => void;
  hideResult: () => void;
  readonly visible: boolean;
  dispose: () => void;
}

export interface BattleHudOptions {
  onAction: (action: PlayerBattleAction) => void;
  onDone: () => void;
  onLeave: () => void;
}

/** Which side a plate shows, for the dev hook and tests. */
export const plateSideOf = (mySide: BattleSideId, side: BattleSideId): 'mine' | 'theirs' =>
  side === mySide ? 'mine' : 'theirs';

const CALLOUT_MS = 1100; // TUNE: long enough to read "Super cozy!"

export function mountBattleHud(root: HTMLElement, options: BattleHudOptions): BattleHud {
  const plate = (side: 'mine' | 'theirs') => {
    const name = el('span', { class: 'battle-plate-name' });
    const nature = el('span', { class: 'battle-plate-nature' });
    const bar = el('div', { class: 'battle-energy-fill' });
    const energy = el('span', {
      class: 'battle-plate-energy',
      'data-testid': `battle-energy-${side}`,
    });
    const status = el('span', { class: 'battle-plate-status' });
    const callout = el('span', { class: 'battle-callout', role: 'status' });
    const node = el(
      'div',
      { class: `battle-plate battle-plate-${side}`, 'data-testid': `battle-plate-${side}` },
      el('div', { class: 'battle-plate-head' }, name, status),
      nature,
      el('div', { class: 'battle-energy', role: 'progressbar', 'aria-label': 'Energy' }, bar),
      energy,
      callout,
    );
    return { node, name, nature, bar, energy, status, callout, timer: 0 };
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

  const hud = el(
    'section',
    { class: 'battle-hud', 'data-testid': 'battle-hud', 'aria-label': 'Squishy showdown' },
    plates.theirs.node,
    // Mine sits with the controls, like a hand of cards; theirs is up top.
    el('div', { class: 'battle-bottom' }, plates.mine.node, caption, controls, problem),
    leave,
    result,
  );
  hud.hidden = true;
  root.append(hud);

  const button = (
    label: string,
    onClick: () => void,
    extra: { soft?: boolean; testId?: string; small?: boolean } = {},
  ) => {
    const classes = ['auth-button', 'battle-button'];
    if (extra.soft) classes.push('auth-button-soft');
    if (extra.small) classes.push('auth-button-small');
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
              {
                testId: 'battle-move',
              },
            ),
          );
        }
        const row = el('div', { class: 'battle-row' });
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
    },
    hide: () => {
      hud.hidden = true;
      result.hidden = true;
    },
    setPlate: (side, info) => {
      const p = plates[side];
      p.name.textContent = info.name;
      p.nature.textContent = info.nature;
      p.bar.style.width = `${String(info.percent)}%`;
      p.bar.classList.toggle('battle-energy-low', info.percent <= 25);
      p.energy.textContent = info.energyText;
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
    get visible() {
      return !hud.hidden;
    },
    dispose: () => {
      for (const p of Object.values(plates)) window.clearTimeout(p.timer);
      hud.remove();
    },
  };
}
