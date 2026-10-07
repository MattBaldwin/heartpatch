import {
  LoginRequestSchema,
  RecoverRequestSchema,
  SignupRequestSchema,
  type PublicUser,
} from '@heartpatch/shared';
import { updateHold } from '../../pwa/update-hold.js';
import { accountApi } from '../account/account-api.js';
import { deviceTimeZone, el, messageOf, type Attrs } from '../dom.js';
import { authApi } from './auth-api.js';
import { AUTH_HELP_TEXT, nameList } from './auth-help-text.js';
import { forgetNames, rememberedNames, rememberName } from './remembered-names.js';
import { saveCodePanel } from './save-code.js';
import './auth.css';

// Sign up, log in and recovery as a DOM overlay over the canvas (tech spec §6).
// Copy follows docs/STYLE_GUIDE.md: short, warm, kid-readable.

interface FieldSpec {
  name: string;
  label: string;
  hint?: string;
  /** Attributes for the `<input>`; ignored when `options` makes it a `<select>`. */
  input?: Attrs;
  options?: { value: string; label: string }[];
}

/** A message to show, and the field to focus. */
interface FormProblem {
  error: string;
  field?: string;
}

interface FormSpec {
  id: string;
  title: string;
  subtitle: string;
  fields: FieldSpec[];
  submitLabel: string;
  /** Shown between the subtitle and the fields (the remembered names, #197). */
  intro?: Node[];
  /** Resolves to a problem to show, or null on success. */
  onSubmit: (values: Record<string, string>) => Promise<FormProblem | null>;
  /** `pair` links sit side by side with the next `pair` link. */
  links: { label: string; onClick: () => void; testId: string; pair?: boolean }[];
}

const textInput = (extra: Attrs): Attrs => ({
  type: 'text',
  autocapitalize: 'none',
  autocorrect: 'off',
  spellcheck: 'false',
  ...extra,
});

function birthYearOptions(): { value: string; label: string }[] {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 96 }, (_, i) => String(thisYear - 4 - i)); // TUNE: ages 4–99
  return [{ value: '', label: 'Pick a year' }, ...years.map((y) => ({ value: y, label: y }))];
}

/** The first problem from a shared schema, with the field it belongs to. */
function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): FormProblem {
  const issue = error.issues[0];
  const field = issue?.path[0];
  return {
    error: issue?.message ?? 'Something in there needs another look.',
    ...(typeof field === 'string' ? { field } : {}),
  };
}

export interface AuthOverlayOptions {
  /** Called whenever the player logs in or out. */
  onChange?: (user: PublicUser | null) => void;
  /**
   * Over the map the chip folds into a Keeper menu in the corner (owner
   * decision 2026-10-04): these rows sit above "Log out" in it.
   */
  menu?: () => Node[];
  /** Under the name in that menu, e.g. the game's version (#198). */
  menuHead?: () => Node[];
}

/**
 * Shows the welcome / sign-up / log-in screens until the player is logged in,
 * then a small "Hi, name!" chip with a log-out button. While the map's trays
 * are up (`hp-trays-on` on the body), the chip is a round Keeper button that
 * opens a little menu; it stays above Sprout's layer, so "Log out" is always
 * reachable.
 */
export function mountAuth(root: HTMLElement, options: AuthOverlayOptions = {}): void {
  const overlay = el('div', { class: 'auth-overlay', 'data-testid': 'auth-overlay' });
  overlay.hidden = true;
  const card = el('div', {
    class: 'auth-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'auth-title',
    // Focus moves to the card, not a button (#158): a screen reader starts
    // at the title and Tab reaches the buttons, but nobody sees a keyboard
    // focus ring on a button they never tabbed to.
    tabindex: '-1',
  });
  overlay.append(card);

  const chipName = el('span', { class: 'auth-chip-name', 'data-testid': 'auth-user' });
  const chipStatus = el('span', { class: 'auth-chip-status', role: 'status' });
  const logoutButton = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-small' },
    'Log out',
  );
  const menuHead = el('div', { class: 'auth-chip-head' });
  const menuRows = el('div', { class: 'auth-chip-menu', role: 'group' });
  const menuToggle = el(
    'button',
    {
      type: 'button',
      class: 'auth-chip-toggle',
      'aria-label': 'Keeper menu',
      'aria-expanded': 'false',
      'data-testid': 'keeper-menu',
    },
    el('span', { class: 'auth-chip-face', 'aria-hidden': 'true' }),
  );
  const chip = el(
    'div',
    { class: 'auth-chip' },
    menuToggle,
    el('div', { class: 'auth-chip-body' }, chipName, menuHead, chipStatus, menuRows, logoutButton),
  );
  chip.hidden = true;
  root.append(overlay, chip);

  const setMenu = (open: boolean) => {
    chip.classList.toggle('auth-chip-open', open);
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuHead.replaceChildren(...(open ? (options.menuHead?.() ?? []) : []));
    menuRows.replaceChildren(...(open ? (options.menu?.() ?? []) : []));
  };
  menuToggle.addEventListener('click', () => {
    setMenu(!chip.classList.contains('auth-chip-open'));
  });
  // A row (or the head's version line, which opens What's new) opened
  // something: the menu folds away.
  const foldOnButton = (e: Event) => {
    if (e.target instanceof Element && e.target.closest('button')) setMenu(false);
  };
  menuRows.addEventListener('click', foldOnButton);
  menuHead.addEventListener('click', foldOnButton);

  /** Set while a recovery code is on screen: no update may reload it away. */
  let releaseUpdates: (() => void) | null = null;
  const letUpdatesThrough = () => {
    releaseUpdates?.();
    releaseUpdates = null;
  };

  const showCard = (...children: Node[]) => {
    letUpdatesThrough();
    card.replaceChildren(...children);
    overlay.hidden = false;
    chip.hidden = true;
    setMenu(false);
    card.focus({ preventScroll: true });
  };

  const signedIn = (user: PublicUser) => {
    letUpdatesThrough();
    // This device remembers who plays on it (#197); never the password.
    rememberName(user.username);
    overlay.hidden = true;
    card.replaceChildren();
    chipName.textContent = `Hi, ${user.username}!`;
    chipStatus.textContent = '';
    chip.hidden = false;
    options.onChange?.(user);
  };

  const signedOut = (notice?: string) => {
    showWelcome(notice);
    options.onChange?.(null);
  };

  logoutButton.addEventListener('click', () => {
    logoutButton.disabled = true;
    authApi
      .logout()
      .then(() => {
        signedOut();
      })
      .catch((err: unknown) => {
        chipStatus.textContent = messageOf(err);
      })
      .finally(() => {
        logoutButton.disabled = false;
      });
  });

  function buildForm(spec: FormSpec): HTMLFormElement {
    const error = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'auth-error' });
    const submit = el('button', { type: 'submit', class: 'auth-button' }, spec.submitLabel);
    const form = el(
      'form',
      { class: 'auth-form', id: spec.id, novalidate: '' },
      el('h1', { class: 'auth-title', id: 'auth-title' }, spec.title),
      el('p', { class: 'auth-subtitle' }, spec.subtitle),
      ...(spec.intro ?? []),
    );
    const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const field of spec.fields) {
      const id = `${spec.id}-${field.name}`;
      let control: HTMLInputElement | HTMLSelectElement;
      if (field.options) {
        control = el('select', { id, name: field.name, class: 'auth-input' });
        for (const option of field.options) {
          control.append(el('option', { value: option.value }, option.label));
        }
      } else {
        control = el('input', { id, name: field.name, class: 'auth-input', ...field.input });
      }
      controls.set(field.name, control);
      form.append(
        el(
          'div',
          { class: 'auth-field' },
          el('label', { for: id }, field.label),
          control,
          ...(field.hint ? [el('p', { class: 'auth-hint' }, field.hint)] : []),
        ),
      );
    }
    form.append(error, submit);
    let pairRow: HTMLElement | null = null;
    for (const link of spec.links) {
      const button = el(
        'button',
        { type: 'button', class: 'auth-link', 'data-testid': link.testId },
        link.label,
      );
      button.addEventListener('click', link.onClick);
      if (!link.pair) {
        pairRow = null;
        form.append(button);
        continue;
      }
      if (!pairRow) {
        pairRow = el('div', { class: 'auth-link-row' });
        form.append(pairRow);
      }
      pairRow.append(button);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const values = Object.fromEntries(
        [...controls].map(([name, control]) => [name, control.value]),
      );
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = 'One moment…';
      void spec
        .onSubmit(values)
        .catch((err: unknown): FormProblem => ({ error: messageOf(err) }))
        .then((result) => {
          if (!result) return;
          error.textContent = result.error;
          if (result.field) controls.get(result.field)?.focus();
        })
        .finally(() => {
          submit.disabled = false;
          submit.textContent = spec.submitLabel;
        });
    });
    return form;
  }

  function showWelcome(notice?: string): void {
    const login = el('button', { type: 'button', class: 'auth-button' }, 'Log in');
    const signup = el(
      'button',
      { type: 'button', class: 'auth-button auth-button-soft' },
      'Sign up',
    );
    login.addEventListener('click', () => {
      showLogin();
    });
    signup.addEventListener('click', showSignup);
    showCard(
      el('h1', { class: 'auth-title', id: 'auth-title' }, 'Welcome to Heartpatch!'),
      el('p', { class: 'auth-subtitle' }, 'The squishies have missed you.'),
      ...(notice ? [el('p', { class: 'auth-error', role: 'alert' }, notice)] : []),
      el('div', { class: 'auth-actions' }, login, signup),
    );
  }

  /**
   * The log in screen. With names remembered on this device (#197) the
   * player taps theirs; "Someone else" (`typeName`) shows the name box.
   */
  function showLogin(typeName = false): void {
    const names = rememberedNames();
    if (names.length > 0 && !typeName) {
      showRememberedLogin(names);
      return;
    }
    showCard(
      buildForm({
        id: 'auth-login',
        title: 'Welcome back!',
        subtitle: 'Log in to visit your patch.',
        fields: [
          { name: 'username', label: 'Name', input: textInput({ autocomplete: 'username' }) },
          {
            name: 'password',
            label: 'Password',
            input: { type: 'password', autocomplete: 'current-password' },
          },
        ],
        submitLabel: 'Log in',
        onSubmit: async (values) => {
          const parsed = LoginRequestSchema.safeParse(values);
          if (!parsed.success) return firstIssue(parsed.error);
          signedIn(await authApi.login(parsed.data));
          return null;
        },
        links: [
          { label: AUTH_HELP_TEXT.forgotName, onClick: showForgotName, testId: 'auth-forgot-name' },
          { label: 'Forgot your password?', onClick: showRecover, testId: 'auth-to-recover' },
          { label: 'New here? Sign up', onClick: showSignup, testId: 'auth-to-signup' },
        ],
      }),
    );
  }

  /** "Who's playing?": tap your name, then type your password. */
  function showRememberedLogin(names: string[]): void {
    let picked = names[0] ?? '';
    const passwordLabel = (name: string) => `Password for ${name}`;
    const buttons = names.map((name) => {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'auth-name',
          'aria-pressed': name === picked ? 'true' : 'false',
          'data-testid': 'auth-remembered-name',
        },
        el('span', { class: 'auth-name-face', 'aria-hidden': 'true' }),
        name,
      );
      button.addEventListener('click', () => {
        picked = name;
        for (const b of buttons) {
          b.setAttribute('aria-pressed', b === button ? 'true' : 'false');
        }
        const label = form.querySelector('label[for="auth-login-password"]');
        if (label) label.textContent = passwordLabel(name);
        form.querySelector<HTMLInputElement>('#auth-login-password')?.focus();
      });
      return button;
    });
    const form = buildForm({
      id: 'auth-login',
      title: 'Welcome back!',
      subtitle: AUTH_HELP_TEXT.whoPlaying,
      intro: [el('div', { class: 'auth-names', role: 'group', 'aria-label': 'Names' }, ...buttons)],
      fields: [
        {
          name: 'password',
          label: passwordLabel(picked),
          input: { type: 'password', autocomplete: 'current-password' },
        },
      ],
      submitLabel: 'Log in',
      onSubmit: async (values) => {
        const parsed = LoginRequestSchema.safeParse({ ...values, username: picked });
        if (!parsed.success) return firstIssue(parsed.error);
        signedIn(await authApi.login(parsed.data));
        return null;
      },
      links: [
        {
          label: AUTH_HELP_TEXT.someoneElse,
          onClick: () => {
            showLogin(true);
          },
          testId: 'auth-someone-else',
          pair: true,
        },
        {
          label: AUTH_HELP_TEXT.notYou,
          onClick: () => {
            showForgetNames(names);
          },
          testId: 'auth-not-you',
          pair: true,
        },
        { label: 'Forgot your password?', onClick: showRecover, testId: 'auth-to-recover' },
      ],
    });
    showCard(form);
  }

  /** "Not you?" asks first (style guide §3.6), then forgets every name. */
  function showForgetNames(names: string[]): void {
    const forget = el('button', { type: 'button', class: 'auth-button' }, AUTH_HELP_TEXT.forget);
    const keep = el(
      'button',
      { type: 'button', class: 'auth-button auth-button-soft' },
      AUTH_HELP_TEXT.keep,
    );
    forget.addEventListener('click', () => {
      forgetNames();
      showLogin();
    });
    keep.addEventListener('click', () => {
      showLogin();
    });
    showCard(
      el('h1', { class: 'auth-title', id: 'auth-title' }, AUTH_HELP_TEXT.forgetTitle),
      el('p', { class: 'auth-subtitle' }, `This device will stop remembering ${nameList(names)}.`),
      el('p', { class: 'auth-hint auth-center' }, AUTH_HELP_TEXT.forgetHint),
      el('div', { class: 'auth-actions' }, forget, keep),
    );
  }

  /**
   * "Forgot your name?" (#197): the three ways back, in a sheet over the log
   * in screen. It only explains; nothing is looked up, so there's no box to
   * type a guess into.
   */
  function showForgotName(): void {
    const close = el('button', { type: 'button', class: 'auth-button' }, AUTH_HELP_TEXT.gotIt);
    const sheet = el(
      'div',
      {
        class: 'auth-sheet',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'auth-sheet-title',
        tabindex: '-1',
        'data-testid': 'auth-forgot-name-sheet',
      },
      el('h2', { class: 'auth-title', id: 'auth-sheet-title' }, AUTH_HELP_TEXT.forgotName),
      el('p', { class: 'auth-subtitle' }, AUTH_HELP_TEXT.forgotNameSubtitle),
      ...AUTH_HELP_TEXT.ways.map((way) =>
        el(
          'div',
          { class: 'auth-way' },
          el('span', { class: 'auth-way-icon', 'aria-hidden': 'true' }, way.icon),
          el(
            'span',
            { class: 'auth-way-text' },
            el('strong', {}, way.title),
            el('span', {}, way.body),
          ),
        ),
      ),
      close,
    );
    const backdrop = el('div', { class: 'auth-sheet-backdrop' }, sheet);
    const dismiss = () => {
      backdrop.remove();
      card.focus({ preventScroll: true });
    };
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) dismiss();
    });
    overlay.append(backdrop);
    sheet.focus({ preventScroll: true });
  }

  function showSignup(): void {
    showCard(
      buildForm({
        id: 'auth-signup',
        title: 'Hello, new Keeper!',
        subtitle: 'Make your account. No email needed.',
        fields: [
          {
            name: 'signupCode',
            label: 'Family or invite code',
            // A patch invite signs you up and asks to join, in one go (#195).
            hint: 'A grown-up has this. A patch invite code works too!',
            input: textInput({ autocomplete: 'off', autocapitalize: 'characters' }),
          },
          {
            name: 'username',
            label: 'Pick a name',
            hint: 'Letters, numbers and _. Not your real name!',
            input: textInput({ autocomplete: 'username', maxlength: '16' }),
          },
          {
            name: 'password',
            label: 'Pick a password',
            hint: 'At least 8 characters.',
            input: { type: 'password', autocomplete: 'new-password' },
          },
          { name: 'birthYear', label: 'Year you were born', options: birthYearOptions() },
        ],
        submitLabel: 'Sign up',
        onSubmit: async (values) => {
          const parsed = SignupRequestSchema.safeParse({
            ...values,
            birthYear: values['birthYear'] ? Number(values['birthYear']) : undefined,
            timeZone: deviceTimeZone(),
          });
          if (!parsed.success) return firstIssue(parsed.error);
          const result = await authApi.signup(parsed.data);
          // Asked now, while the code is saved: the helper step is ready on "Next".
          const helper = accountApi
            .candidates()
            .then((list) => list.find((c) => c.reason === 'invited-you') ?? null)
            .catch(() => null);
          showRecoveryCode(result.user, result.recoveryCode, "Ta-da! You're in!", () => {
            void helper.then((candidate) => {
              if (candidate) showHelperStep(result.user, candidate.user);
              else signedIn(result.user);
            });
          });
          return null;
        },
        links: [
          {
            label: 'Have an account? Log in',
            onClick: () => {
              showLogin();
            },
            testId: 'auth-to-login',
          },
        ],
      }),
    );
  }

  function showRecover(): void {
    showCard(
      buildForm({
        id: 'auth-recover',
        title: 'Forgot your password?',
        subtitle: 'Use your recovery code to pick a new one.',
        fields: [
          { name: 'username', label: 'Name', input: textInput({ autocomplete: 'username' }) },
          {
            name: 'recoveryCode',
            label: 'Recovery code',
            hint: 'Like ABCD-EFGH-JKMN.',
            input: textInput({ autocomplete: 'off', autocapitalize: 'characters' }),
          },
          {
            name: 'newPassword',
            label: 'New password',
            hint: 'At least 8 characters.',
            input: { type: 'password', autocomplete: 'new-password' },
          },
        ],
        submitLabel: 'Reset',
        onSubmit: async (values) => {
          const parsed = RecoverRequestSchema.safeParse(values);
          if (!parsed.success) return firstIssue(parsed.error);
          const result = await authApi.recover(parsed.data);
          showRecoveryCode(result.user, result.recoveryCode, 'All set! New password saved.', () => {
            signedIn(result.user);
          });
          return null;
        },
        links: [
          {
            label: 'Back to log in',
            onClick: () => {
              showLogin();
            },
            testId: 'auth-to-login',
          },
        ],
      }),
    );
  }

  /** The code is shown once, so make saving it the obvious next step (#197). */
  function showRecoveryCode(
    user: PublicUser,
    code: string,
    title: string,
    onDone: () => void,
  ): void {
    showCard(
      saveCodePanel({ title, titleId: 'auth-title', username: user.username, code, onDone }),
    );
    // Shown once: an automatic update must not reload it away (#47).
    releaseUpdates = updateHold.hold();
  }

  /**
   * "Do you have a grown-up helper?" (#197): offered once after sign up, only
   * when a grown-up brought the player in. Never required.
   */
  function showHelperStep(user: PublicUser, grownup: PublicUser): void {
    const error = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'auth-error' });
    const ask = el('button', { type: 'button', class: 'auth-button' }, `Ask ${grownup.username}`);
    const later = el(
      'button',
      { type: 'button', class: 'auth-button auth-button-soft' },
      AUTH_HELP_TEXT.maybeLater,
    );
    ask.addEventListener('click', () => {
      if (ask.disabled) return;
      ask.disabled = true;
      error.textContent = '';
      accountApi
        .ask(grownup.id)
        .then(() => {
          signedIn(user);
        })
        .catch((err: unknown) => {
          error.textContent = messageOf(err);
          ask.disabled = false;
        });
    });
    later.addEventListener('click', () => {
      signedIn(user);
    });
    showCard(
      el('h1', { class: 'auth-title', id: 'auth-title' }, AUTH_HELP_TEXT.helperTitle),
      el('p', { class: 'auth-subtitle' }, AUTH_HELP_TEXT.helperSubtitle),
      el(
        'div',
        { class: 'lobby-choice', 'aria-checked': 'true', role: 'radio' },
        el(
          'span',
          { class: 'lobby-choice-label' },
          grownup.username,
          el('span', { class: 'lobby-choice-picked', 'aria-hidden': 'true' }, '✓ Picked'),
        ),
        el('span', { class: 'lobby-choice-hint' }, AUTH_HELP_TEXT.reasons['invited-you']),
      ),
      error,
      el('div', { class: 'auth-actions' }, ask, later),
      el('p', { class: 'auth-hint auth-center' }, AUTH_HELP_TEXT.helperLater),
    );
  }

  authApi
    .me()
    .then((user) => {
      if (user) signedIn(user);
      else signedOut();
    })
    .catch((err: unknown) => {
      signedOut(messageOf(err));
    });
}
