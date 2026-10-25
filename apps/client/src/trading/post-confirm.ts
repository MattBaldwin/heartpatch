import { hpClose } from '../ui/button/button.js';
import { el } from '../ui/dom.js';

// The post's one confirm sheet (#655; the owner-approved mockup v4, screens 2
// and 3): it rises over the list from the bottom and says exactly what will
// happen, line by line, before anything leaves (style guide §3.6, every sale
// has a confirm step, #601 Q7). Sell uses it now; Gift reuses it in part D.
// Only layout: the caller owns the state and what Yes does.

type ButtonKind = 'primary' | 'secondary' | 'gold' | 'quiet';

/** One line of what goes: a little picture, the words, and (for a sale) what it pays. */
export interface ConfirmLine {
  readonly icon: string;
  readonly text: string;
  readonly right?: string;
}

export interface ConfirmSheet {
  readonly title: string;
  /** `data-testid` of the sheet; its buttons are `<testId>-yes` and `<testId>-no`. */
  readonly testId: string;
  readonly lines: readonly ConfirmLine[];
  /** "24 things" beside "+27 💛". */
  readonly total?: { readonly left: string; readonly right: string };
  /** A small line under the total: "You'll have 81 💛 after." */
  readonly after?: string;
  /** The cream box: what stays and why ("Keeps 1 of each ✨"). One line each. */
  readonly stays?: readonly string[];
  /** The no-undo line. */
  readonly note?: string;
  readonly yes: string;
  readonly no: string;
  /** The post screen's button (it greys out while a command is working). */
  readonly button: (
    label: string,
    testId: string,
    kind: ButtonKind,
    onClick: () => void,
    disabled?: boolean,
  ) => HTMLButtonElement;
  readonly onYes: () => void;
  readonly onNo: () => void;
  readonly yesDisabled?: boolean;
}

/** The dimmed layer and the sheet on it. A tap on the dim, ✕ or "Not now" closes it. */
export function postConfirm(sheet: ConfirmSheet): HTMLElement {
  const titleId = `${sheet.testId}-title`;
  const close = hpClose(sheet.no, `${sheet.testId}-close`);
  close.addEventListener('click', sheet.onNo);
  const dim = el('div', { class: 'post-confirm-dim', 'aria-hidden': 'true' });
  dim.addEventListener('click', sheet.onNo);
  const card = el(
    'div',
    {
      class: 'post-confirm',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-testid': sheet.testId,
    },
    el('h3', { class: 'post-confirm-title' }, el('span', { id: titleId }, sheet.title), close),
    el(
      'ul',
      { class: 'post-confirm-lines', 'data-testid': `${sheet.testId}-lines` },
      ...sheet.lines.map((line) =>
        el(
          'li',
          { class: 'post-confirm-line' },
          el('span', { class: 'post-confirm-icon', 'aria-hidden': 'true' }, line.icon),
          el('span', { class: 'post-confirm-text' }, line.text),
          el('span', { class: 'post-confirm-coins' }, line.right ?? ''),
        ),
      ),
    ),
    ...(sheet.total
      ? [
          el(
            'div',
            { class: 'post-confirm-total', 'data-testid': `${sheet.testId}-total` },
            el('span', {}, sheet.total.left),
            el('em', {}, sheet.total.right),
          ),
        ]
      : []),
    ...(sheet.after
      ? [
          el(
            'p',
            { class: 'post-confirm-after', 'data-testid': `${sheet.testId}-after` },
            sheet.after,
          ),
        ]
      : []),
    ...(sheet.stays?.length
      ? [
          el(
            'div',
            { class: 'post-confirm-stays', 'data-testid': `${sheet.testId}-stays` },
            ...sheet.stays.map((s) => el('p', {}, s)),
          ),
        ]
      : []),
    ...(sheet.note ? [el('p', { class: 'post-confirm-note' }, sheet.note)] : []),
    el(
      'div',
      { class: 'post-confirm-acts' },
      sheet.button(sheet.no, `${sheet.testId}-no`, 'quiet', sheet.onNo),
      sheet.button(sheet.yes, `${sheet.testId}-yes`, 'primary', sheet.onYes, sheet.yesDisabled),
    ),
  );
  return el('div', { class: 'post-confirm-layer' }, dim, card);
}
