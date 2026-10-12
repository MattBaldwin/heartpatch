import type { HouseNextLevel, HouseView, RequirementProgress } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import {
  buildLabel,
  confirmLine,
  costLine,
  growGroups,
  growHeader,
  growNeeds,
  growState,
  rowCount,
  rowFill,
  type GrowGroup,
} from './house-grow-view.js';
import { GROW_TEXT } from './house-view.js';

/*
 * The Grow the house sheet's DOM (#381 plan §10.4–10.5): the header, the
 * requirement rows under their group headings, the cost with my counts, and
 * Build it! (or "Not yet"), then the confirm. Everything it says comes from
 * `house-grow-view.ts` and the server's rows; the house screen owns the
 * sheet, the build and the reply.
 */

/** A button in the house's look: 44pt+ and padded with the shared tokens. */
export function houseButton(
  label: string,
  onTap: () => void,
  attrs: Record<string, string> = {},
  soft = false,
): HTMLButtonElement {
  const { class: more = '', ...rest } = attrs;
  const b = el(
    'button',
    {
      type: 'button',
      class: `house-button${soft ? ' house-button-soft' : ''} ${more}`.trim(),
      ...rest,
    },
    label,
  );
  b.addEventListener('click', onTap);
  return b;
}

function row(r: RequirementProgress): HTMLElement {
  const fill = el('span', { class: 'house-grow-fill' });
  fill.style.width = `${String(Math.round(rowFill(r) * 100))}%`;
  return el(
    'li',
    {
      class: `house-grow-row${r.done ? ' house-grow-row-done' : ''}`,
      'data-testid': 'house-grow-row',
      'data-done': String(r.done),
    },
    el(
      'span',
      {
        class: 'house-grow-mark',
        role: 'img',
        'aria-label': r.done ? GROW_TEXT.done : GROW_TEXT.toDo,
      },
      r.done ? '✅' : '⬜',
    ),
    el(
      'span',
      { class: 'house-grow-main' },
      el(
        'span',
        { class: 'house-grow-top' },
        el('span', { class: 'house-grow-line' }, r.line),
        el('span', { class: 'house-grow-count' }, rowCount(r)),
      ),
      el('span', { class: 'house-grow-bar', 'aria-hidden': 'true' }, fill),
      ...(r.hint ? [el('span', { class: 'house-grow-hint' }, r.hint)] : []),
    ),
  );
}

function group(g: GrowGroup): HTMLElement {
  return el(
    'section',
    { class: 'house-grow-group', 'data-testid': `house-grow-group-${g.group}` },
    el(
      'h4',
      { class: 'house-grow-group-title' },
      el('span', { 'aria-hidden': 'true' }, g.icon),
      ` ${g.title}`,
    ),
    el('ul', { class: 'house-grow-rows' }, ...g.rows.map(row)),
  );
}

/** The cost with my counts: "You need: 60 Timber · 50 Stone" and have/need chips, short ones marked. */
function cost(view: HouseView, next: HouseNextLevel): HTMLElement[] {
  return [
    el(
      'p',
      { class: 'house-grow-need-title', 'data-testid': 'house-grow-cost' },
      `${GROW_TEXT.youNeed} ${costLine(next.cost)}`,
    ),
    el(
      'span',
      { class: 'house-grow-needs' },
      ...growNeeds(view, next).map((n) =>
        el(
          'span',
          {
            class: `house-grow-need${n.ok ? ' house-grow-need-ok' : ''}`,
            'data-testid': 'house-grow-need',
            'aria-label': `${n.name}: ${String(n.have)} of ${String(n.need)}`,
          },
          n.ok ? `${n.label} ✓` : n.label,
        ),
      ),
    ),
  ];
}

export interface GrowHandlers {
  onBuild: () => void;
  onBack: () => void;
}

/** The Grow the house sheet for a house with a next level. */
export function growPanel(view: HouseView, next: HouseNextLevel, on: GrowHandlers): HTMLElement[] {
  const state = growState(view);
  const go = houseButton(buildLabel(state), on.onBuild, {
    class: 'house-grow-build',
    'data-testid': 'house-grow-build',
  });
  go.disabled = state.kind !== 'ready';
  return [
    el(
      'div',
      { class: 'house-grow-head' },
      houseButton(`‹ ${GROW_TEXT.back}`, on.onBack, { 'data-testid': 'house-grow-back' }, true),
      el(
        'h3',
        { class: 'house-grow-title', 'data-testid': 'house-grow-title' },
        growHeader(view, next),
      ),
    ),
    ...growGroups(next).map(group),
    ...cost(view, next),
    go,
    ...(state.kind === 'not-yet' && state.first
      ? [el('p', { class: 'house-grow-next', 'data-testid': 'house-grow-next' }, state.first)]
      : []),
  ];
}

export interface ConfirmHandlers {
  onYes: () => void;
  onNo: () => void;
}

/** "Build the Kitchen for 60 Timber, 50 Stone and 4 Glimmer?" (style guide §3.6). */
export function confirmPanel(
  next: HouseNextLevel,
  busy: boolean,
  on: ConfirmHandlers,
): HTMLElement[] {
  const yes = houseButton(busy ? GROW_TEXT.building : GROW_TEXT.confirmYes, on.onYes, {
    class: 'house-grow-yes',
    'data-testid': 'house-grow-yes',
  });
  const no = houseButton(GROW_TEXT.notNow, on.onNo, { 'data-testid': 'house-grow-no' }, true);
  yes.disabled = busy;
  no.disabled = busy;
  return [
    el(
      'p',
      { class: 'house-grow-confirm', 'data-testid': 'house-grow-confirm' },
      confirmLine(next),
    ),
    el('div', { class: 'house-sheet-row' }, yes, no),
  ];
}

/**
 * A little burst of sparkles from the top of `from` (the sheet) after a
 * build, drawn on `layer` so the sheet's scroll never clips it; nothing
 * under reduced motion.
 */
export function sparkle(layer: HTMLElement, from: HTMLElement, reducedMotion: boolean): void {
  if (reducedMotion) return;
  const box = from.getBoundingClientRect();
  const burst = el(
    'span',
    { class: 'house-sparkle', 'aria-hidden': 'true' },
    ...Array.from({ length: 7 }, (_, i) => {
      const s = el('span', { class: 'house-sparkle-bit' }, i % 2 ? '✨' : '💖');
      s.style.setProperty('--i', String(i));
      return s;
    }),
  );
  burst.style.left = `${String(box.left + box.width / 2)}px`;
  burst.style.top = `${String(box.top)}px`;
  layer.append(burst);
  burst.addEventListener('animationend', (e) => {
    if (e.target === burst.lastElementChild) burst.remove();
  });
  // A backstop if no animation runs (a hidden tab).
  setTimeout(() => {
    burst.remove();
  }, 2000);
}
