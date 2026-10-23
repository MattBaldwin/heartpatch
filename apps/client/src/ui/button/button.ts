import { el, type Attrs } from '../dom.js';
import { CLOSE_ICON_PATH, strokeIcon } from '../stroke-icon.js';
import './button.css';
import './press.css';

/*
 * The shared button (Controls A, style guide §10): `.hp-button` in three
 * looks, plus the sheet close (✕) and the screen back ("‹ Back"), so new
 * screens stop growing their own button classes. The look and the CSS
 * tokens are in `button.css`; the press squish every button gets, shared or
 * not, is in `press.css`.
 */

// Player-facing text (style guide §2, §6).
export const BUTTON_TEXT = {
  back: 'Back',
} as const;

/** Primary: the one obvious next step on a screen. Secondary: the rest. Quiet: a text-only "Not now". */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonOptions {
  variant?: ButtonVariant;
  /** 44 px tall instead of 52, for rows of small choices. */
  small?: boolean;
  testId?: string;
}

/** The classes for a shared button, for markup built elsewhere. */
export function buttonClass({ variant = 'secondary', small = false }: ButtonOptions = {}): string {
  return ['hp-button', `hp-button-${variant}`, ...(small ? ['hp-button-small'] : [])].join(' ');
}

const testAttr = (testId: string | undefined): Attrs => (testId ? { 'data-testid': testId } : {});

/** A shared button with its label (and any icon) inside. */
export function hpButton(label: Node | string, options: ButtonOptions = {}): HTMLButtonElement {
  return el(
    'button',
    { type: 'button', class: buttonClass(options), ...testAttr(options.testId) },
    label,
  );
}

/** The round ✕ for a sheet's corner; `label` is what it reads aloud ("Close the Bag"). */
export function hpClose(label: string, testId?: string): HTMLButtonElement {
  return el(
    'button',
    { type: 'button', class: 'hp-close', 'aria-label': label, ...testAttr(testId) },
    strokeIcon(CLOSE_ICON_PATH),
  );
}

/** The "‹ Back" pill for a screen's top left. */
export function hpBack(label: string = BUTTON_TEXT.back, testId?: string): HTMLButtonElement {
  return el(
    'button',
    { type: 'button', class: 'hp-back', ...testAttr(testId) },
    el('span', { class: 'hp-back-chevron', 'aria-hidden': 'true' }, '‹'),
    label,
  );
}

/**
 * Lets iOS Safari show `:active` while a finger rests on a button (it only
 * does once some touchstart listener is on the page), so the press squish in
 * `press.css` shows on touch. Once, for the whole app.
 */
export function installPressFeel(root: Document): void {
  root.addEventListener('touchstart', () => {}, { passive: true });
}
