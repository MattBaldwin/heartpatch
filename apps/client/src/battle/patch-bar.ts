import type { BossBarState } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import './patch-bar.css';

// The Christmas Eve patch bar on screen (#37 X4). In a fight it is a thin
// full-width line under the boss strip, filling left to right and turning
// gold when full (owner decision, #37 comment 7225429326). The ❄ and the
// percentage live off the line: on the map's Eve card and the fight's
// "Chipped!" sticker. The server sends the raw `goal` and `chipped` (rule 1,
// rule 6: the goal's formula and the head start stay server-side); this file
// only rounds them for display. Pure model first, DOM after.

/**
 * The line's look, one config for every screen (phone portrait, phone on its
 * side, iPad): change `lineHeight` or `gap` here and the CSS, the stage band
 * and the screen all follow. Set on the HUD as `--patch-bar-*` (`patchBarVars`).
 */
export const PATCH_BAR = {
  /** The line's thickness, px; the stage band gives up this much under the strip. */
  lineHeight: 4, // TUNE:
  /** The gap between the strip's bottom and the line, px (inside the camera's strip margin). */
  gap: 2, // TUNE:
  /** The shown percentage moves in steps of this many percent (X2 handoff). */
  stepPercent: 5,
  /** How long the fill takes to move, ms (a snap under reduced motion). */
  fillMs: 450, // TUNE:
} as const;

/** The bar as the server sends it (`PlayerBattle.boss.patchBar`, `MapView.christmas.eve`). */
export interface PatchBarState {
  readonly goal: number;
  readonly chipped: number;
  readonly state: BossBarState;
}

/** Player-facing words (style guide: cozy, short, kid-readable; 14 px floor). */
export const PATCH_BAR_TEXT = {
  /** The line's screen-reader label. */
  label: (percent: number) => `Patch bar, ${String(percent)} percent`,
  labelFull: 'Patch bar, full',
  /** The tile card's and the sticker's percentage. */
  percent: (percent: number) => `❄ ${String(percent)}%`,
  cardName: 'Patch bar',
  cardOpen: 'Chip in together to fill it up!',
  cardFell: 'Full! Everyone helped. ❄',
  cardDozed: 'It dozed off and wandered home. Thanks for helping! 💤',
  chipped: 'Chipped!',
  youChipped: (points: number) => `You chipped in ${String(points)}!`,
  stickerFull: 'The patch bar is full! ❄',
} as const;

/** Whether the bar is full: it fell, or the points reached the goal. */
export function patchBarFull(bar: PatchBarState): boolean {
  return bar.state === 'fell' || bar.chipped >= bar.goal;
}

/**
 * The percentage to show: `chipped / goal` clamped at 100 (`chipped` can pass
 * `goal` after the fall), rounded to the nearest 5. A bar that isn't full never
 * reads 100 (97 % shows 95), and one with any chip never reads 0, so the line
 * moves after every fight.
 */
export function patchBarPercent(bar: PatchBarState): number {
  if (patchBarFull(bar)) return 100;
  const step = PATCH_BAR.stepPercent;
  const raw = Math.min(1, Math.max(0, bar.chipped / Math.max(1, bar.goal))) * 100;
  const rounded = Math.round(raw / step) * step;
  const top = 100 - step;
  return Math.min(top, bar.chipped > 0 ? Math.max(step, rounded) : 0);
}

/** The screen-reader label: "Patch bar, 40 percent". */
export function patchBarLabel(bar: PatchBarState): string {
  return patchBarFull(bar) ? PATCH_BAR_TEXT.labelFull : PATCH_BAR_TEXT.label(patchBarPercent(bar));
}

/**
 * Takes the newer of two reads of the same bar. Each read is the server's, but
 * they arrive out of order (a view fetched before a chip, a live event after),
 * and the bar only ever goes up, so the one with more chipped wins; a fall
 * stays a fall.
 */
export function newerBar(current: PatchBarState | null, next: PatchBarState): PatchBarState {
  if (!current) return next;
  if (next.chipped < current.chipped) return current;
  return current.state === 'fell' ? { ...next, state: 'fell' } : next;
}

/** `boss.chipped` / `boss.fell` carry the bar's numbers but not its state: a full bar fell. */
export function barFromEvent(data: { chipped: number; goal: number }): PatchBarState {
  return {
    goal: data.goal,
    chipped: data.chipped,
    state: data.chipped >= data.goal ? 'fell' : 'open',
  };
}

/** The line's numbers as the `--patch-bar-*` custom properties battle.css reads. */
export function patchBarVars(config: typeof PATCH_BAR = PATCH_BAR): Record<string, string> {
  const px = (n: number) => `${String(n)}px`;
  return {
    '--patch-bar-h': px(config.lineHeight),
    '--patch-bar-gap': px(config.gap),
    '--patch-bar-fill-ms': `${String(config.fillMs)}ms`,
  };
}

export interface PatchBarLine {
  /** The line's box: it sits under the strip, and its bottom is where the stage starts. */
  readonly el: HTMLElement;
  /**
   * Shows the bar, or hides the line for null (a weekly boss has none).
   * Returns true when the line came or went, so the stage band must be measured again.
   */
  set: (bar: PatchBarState | null) => boolean;
}

/**
 * The line under the boss strip. Its box is as tall as the stage band gives
 * up (`--patch-bar-h`) while a bar shows and 0 when none does, so the camera
 * can frame the stage from this element's bottom and a weekly fight is
 * unchanged.
 */
export function mountPatchBar(): PatchBarLine {
  const fill = el('div', { class: 'patch-bar-fill' });
  const track = el(
    'div',
    {
      class: 'patch-bar-track',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'data-testid': 'patch-bar',
    },
    fill,
  );
  const root = el('div', { class: 'patch-bar' }, track);
  root.hidden = true;
  let drawn = '';
  return {
    el: root,
    set: (bar) => {
      const wasShown = !root.hidden;
      if (!bar) {
        root.hidden = true;
        drawn = '';
        return wasShown;
      }
      root.hidden = false;
      const percent = patchBarPercent(bar);
      const full = patchBarFull(bar);
      const key = `${String(percent)}|${String(full)}`;
      if (key !== drawn) {
        drawn = key;
        fill.style.width = `${String(percent)}%`;
        track.classList.toggle('patch-bar-full', full);
        track.setAttribute('aria-valuenow', String(percent));
        track.setAttribute('aria-label', patchBarLabel(bar));
        track.dataset['percent'] = String(percent);
      }
      return !wasShown;
    },
  };
}

/**
 * The fight's "Chipped!" sticker on the result card: the bar's percentage and,
 * when the server told the chipper their points, "You chipped in N!". Null
 * when the fight had no bar.
 */
export function chippedSticker(
  bar: PatchBarState | null,
  points: number | null,
): HTMLElement | null {
  if (!bar) return null;
  const full = patchBarFull(bar);
  const lines = [
    el('p', { class: 'patch-chipped-title' }, PATCH_BAR_TEXT.chipped),
    ...(points !== null
      ? [el('p', { class: 'patch-chipped-line' }, PATCH_BAR_TEXT.youChipped(points))]
      : []),
    el(
      'p',
      { class: 'patch-chipped-line' },
      full ? PATCH_BAR_TEXT.stickerFull : PATCH_BAR_TEXT.percent(patchBarPercent(bar)),
    ),
  ];
  return el(
    'div',
    {
      class: `patch-chipped${full ? ' patch-chipped-full' : ''}`,
      role: 'status',
      'data-testid': 'patch-chipped',
    },
    ...lines,
  );
}

/** The map card's patch bar: ❄ and the percentage, the same line drawn thicker, and a caption. */
export function eveCardBar(bar: PatchBarState): HTMLElement {
  const full = patchBarFull(bar);
  const percent = patchBarPercent(bar);
  const caption =
    bar.state === 'dozed'
      ? PATCH_BAR_TEXT.cardDozed
      : full
        ? PATCH_BAR_TEXT.cardFell
        : PATCH_BAR_TEXT.cardOpen;
  const fill = el('div', { class: 'patch-bar-fill' });
  fill.style.width = `${String(percent)}%`;
  const track = el(
    'div',
    {
      class: `patch-bar-track patch-card-track${full ? ' patch-bar-full' : ''}`,
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(percent),
      'aria-label': patchBarLabel(bar),
    },
    fill,
  );
  return el(
    'div',
    { class: 'patch-card', 'data-testid': 'patch-card', 'data-percent': String(percent) },
    el(
      'p',
      { class: 'patch-card-head' },
      el('span', {}, PATCH_BAR_TEXT.cardName),
      el('span', { 'data-testid': 'patch-card-percent' }, PATCH_BAR_TEXT.percent(percent)),
    ),
    track,
    el('p', { class: 'patch-card-caption' }, caption),
  );
}
