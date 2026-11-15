import { el } from '../ui/dom.js';
import { createSproutTips, type SproutTips, type SproutTipsOptions } from './sprout-tips.js';
import './sprout-tips.css';

// Sprout's week-two tips on screen (#731 item 5): one small bubble in the
// map's own toast spot, Sprout's face beside the words. The rules (what,
// when, once per account) are in sprout-tips.ts.

export interface SproutTipsScreenOptions extends Pick<
  SproutTipsOptions,
  'busy' | 'facts' | 'storage'
> {
  readonly root: HTMLElement;
}

export interface SproutTipsScreen extends SproutTips {
  /** What is showing now (the dev hook). */
  readonly text: string | null;
}

export function createSproutTipsScreen(options: SproutTipsScreenOptions): SproutTipsScreen {
  const face = el('span', { class: 'sprout-tip-face', 'aria-hidden': 'true' });
  const words = el('span', { class: 'sprout-tip-text' });
  const bubble = el('p', { class: 'sprout-tip', role: 'status', 'data-testid': 'sprout-tip' });
  bubble.append(face, words);
  bubble.hidden = true;
  options.root.append(bubble);

  const tips = createSproutTips({
    ...options,
    show: (text) => {
      words.textContent = text;
      bubble.hidden = false;
    },
    hide: () => {
      bubble.hidden = true;
    },
    setTimer: (task, ms) => window.setTimeout(task, ms),
    clearTimer: (handle) => {
      window.clearTimeout(handle as number);
    },
  });
  return {
    ...tips,
    get text() {
      return bubble.hidden ? null : words.textContent;
    },
  };
}
