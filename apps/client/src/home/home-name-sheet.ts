import { HomeNameSchema, NAMING_RULES, type HomeNaming } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { HOME_NAME_TEXT as T, KIND_NAMES, nameCard } from './home-name-view.js';

// The "Name your home" card (#306 PR 0, owner-approved handoff): locked, it
// shows how far along the gate is (one of each kind built, squishies
// caught); unlocked, a name field with tap-to-fill ideas and "Name it!".
// It lives in the home sheet like the upgrade card. The field is kept
// across redraws so what the player typed survives a reply.

export interface HomeNameSheetProps {
  readonly naming: HomeNaming;
  /** Tap-to-fill ideas (`nameIdeas`). */
  readonly ideas: readonly string[];
  readonly working: boolean;
  /** The server's refusal (or the name rules' own words), shown in the card. */
  readonly error: string | null;
  readonly onName: (name: string) => void;
  /** Error from the name rules before sending: shown in the card, nothing sent. */
  readonly onInvalid: (message: string) => void;
  readonly onClose: () => void;
}

export interface HomeNameSheet {
  readonly element: HTMLElement;
  /** Fresh open: the field starts with `value`. */
  reset: (value: string) => void;
  update: (props: HomeNameSheetProps) => void;
}

export function createHomeNameSheet(): HomeNameSheet {
  const element = el('div', { class: 'home-name', 'data-testid': 'home-name-card' });
  const input = el('input', {
    type: 'text',
    class: 'home-name-input',
    id: 'home-name-input',
    maxlength: String(NAMING_RULES.maxLength),
    placeholder: T.placeholder,
    autocomplete: 'off',
    autocapitalize: 'words',
    enterkeyhint: 'done',
    'data-testid': 'home-name-input',
  });

  const button = (label: string, testId: string, soft: boolean, onTap?: () => void) => {
    const b = el(
      'button',
      {
        type: onTap ? 'button' : 'submit',
        class: `auth-button home-name-${soft ? 'soft auth-button-soft' : 'primary'}`,
        'data-testid': testId,
      },
      label,
    );
    if (onTap) b.addEventListener('click', onTap);
    return b;
  };

  const head = (kicker: string, title: string, line: string) => [
    el('p', { class: 'home-name-kicker' }, kicker),
    el('h3', { class: 'home-name-title', id: 'home-name-title' }, title),
    el('p', { class: 'home-name-line' }, line),
  ];

  const meter = (done: number, total: number) =>
    el(
      'div',
      { class: 'home-name-meter', role: 'img', 'aria-label': T.caughtLabel(done, total) },
      ...Array.from({ length: total }, (_, i) => el('span', { class: i < done ? 'on' : '' })),
    );

  return {
    element,
    reset: (value) => {
      input.value = value;
    },
    update: (props) => {
      const { naming } = props;
      const card = nameCard(naming);
      element.dataset['card'] = card;
      if (card === 'locked') {
        const built = naming.kinds.filter((k) => k.built).length;
        const keep = button(T.keepGoing, 'home-name-keep-going', false, props.onClose);
        element.replaceChildren(
          ...head(T.lockedKicker, T.lockedTitle, T.lockedLine(naming.need)),
          el('p', { class: 'home-name-label' }, T.kindsLine(built, naming.kinds.length)),
          el(
            'ul',
            { class: 'home-name-kinds', 'data-testid': 'home-name-kinds' },
            ...naming.kinds.map((k) =>
              el(
                'li',
                { class: `home-name-kind${k.built ? ' done' : ''}` },
                `${k.built ? '✓' : '○'} ${KIND_NAMES[k.kind]}`,
              ),
            ),
          ),
          el('p', { class: 'home-name-label' }, T.caughtLine(naming.caught, naming.need)),
          meter(naming.caught, naming.need),
          el('p', { class: 'home-name-note' }, T.caughtNote),
          keep,
        );
        return;
      }
      if (card === 'named') {
        element.replaceChildren(
          ...head(T.namedKicker, `🏡 ${naming.name ?? ''}`, T.namedLine),
          button(T.back, 'home-name-back', false, props.onClose),
        );
        return;
      }
      const chips = props.ideas.map((idea) => {
        const b = el(
          'button',
          { type: 'button', class: 'home-name-chip', 'data-testid': 'home-name-idea' },
          idea,
        );
        b.addEventListener('click', () => {
          input.value = idea;
          input.focus();
        });
        return b;
      });
      const go = button(T.nameIt, 'home-name-it', false);
      go.disabled = props.working;
      const notNow = button(T.notNow, 'home-name-not-now', true, props.onClose);
      notNow.disabled = props.working;
      const error = el(
        'p',
        { class: 'home-name-error', role: 'alert', 'data-testid': 'home-name-error' },
        props.error ?? '',
      );
      const form = el(
        'form',
        { class: 'home-name-form', novalidate: '' },
        el('label', { class: 'home-name-label', for: 'home-name-input' }, T.label),
        input,
        error,
        el('div', { class: 'home-name-chips', role: 'group', 'aria-label': T.ideas }, ...chips),
        el('p', { class: 'home-name-note' }, T.note(NAMING_RULES.maxLength)),
        go,
        notNow,
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (props.working) return;
        const parsed = HomeNameSchema.safeParse(input.value);
        if (!parsed.success) {
          props.onInvalid(parsed.error.issues[0]?.message ?? T.placeholder);
          return;
        }
        props.onName(parsed.data);
      });
      element.replaceChildren(
        ...head(
          T.unlockedKicker,
          T.unlockedTitle,
          naming.name === null ? T.unlockedLine(naming.need) : T.grewLine,
        ),
        form,
      );
    },
  };
}
