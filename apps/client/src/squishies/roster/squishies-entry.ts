import { el } from '../../ui/dom.js';
import { ROSTER_TEXT } from './roster-view.js';
import './squishies-entry.css';

// The Squishies button in the top bar (owner, 2026-10-11): one round 🐾 on the
// map, at home and in explore, so the roster is one tap from anywhere. Each
// view has its own copy, placed by squishies-entry.css.

/** A round 🐾 button; its word is for VoiceOver (it keeps the label). */
export function squishiesButton(onTap: () => void, where: string): HTMLButtonElement {
  const button = el(
    'button',
    {
      type: 'button',
      class: `squishies-open squishies-open-${where}`,
      'aria-label': ROSTER_TEXT.title,
      'data-testid': 'squishies-open',
      'data-where': where,
    },
    el('span', { class: 'squishies-open-icon', 'aria-hidden': 'true' }, '🐾'),
    el('span', { class: 'squishies-open-label' }, ROSTER_TEXT.title),
  );
  button.addEventListener('click', onTap);
  return button;
}
