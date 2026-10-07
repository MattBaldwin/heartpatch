import { el } from '../ui/dom.js';
import type { EvolvingBar } from './care-view.js';
import './evolving-meter.css';

// The evolving meter (#205): a bar of its own under the level's XP bar on
// the care sheet, and on the battle results card, where this battle's share
// is striped. Static: it draws once per update and never animates while idle.

export interface EvolvingMeterEl {
  readonly root: HTMLElement;
  /**
   * Shows `bar` (hidden when null). `gainedFrom` (0–1): where this battle's
   * gain starts, striped up to the fill; `sub` replaces the bar's own sub-line.
   */
  update(bar: EvolvingBar | null, options?: { gainedFrom?: number; sub?: string | null }): void;
}

export function evolvingMeterEl(testId: string): EvolvingMeterEl {
  const label = el('span', {});
  const value = el('b', {});
  const fill = el('div', { class: 'evolving-fill' });
  const gain = el('div', { class: 'evolving-gain' });
  const sub = el('p', { class: 'evolving-sub' });
  const root = el(
    'div',
    { class: 'evolving', 'data-testid': testId },
    el('p', { class: 'evolving-line' }, label, value),
    el('div', { class: 'evolving-bar', 'aria-hidden': 'true' }, fill, gain),
    sub,
  );
  root.hidden = true;
  return {
    root,
    update(bar, options = {}) {
      root.hidden = bar === null;
      if (!bar) return;
      root.classList.toggle('evolving-ready', bar.ready);
      label.textContent = bar.label;
      value.textContent = bar.value;
      const to = Math.round(bar.fill * 100);
      const from = Math.round(Math.min(bar.fill, options.gainedFrom ?? bar.fill) * 100);
      fill.style.width = `${String(from)}%`;
      gain.style.left = `${String(from)}%`;
      gain.style.width = `${String(to - from)}%`;
      gain.hidden = to === from;
      const line = options.sub !== undefined ? options.sub : bar.sub;
      sub.textContent = line ?? '';
      sub.hidden = !line;
    },
  };
}
