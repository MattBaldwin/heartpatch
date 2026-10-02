import {
  LoginRequestSchema,
  RecoverRequestSchema,
  SignupRequestSchema,
  type PublicUser,
} from '@heartpatch/shared';
import { ApiRequestError, authApi } from './auth-api.js';
import './auth.css';

// Sign up, log in and recovery as a DOM overlay over the canvas (tech spec §6).
// Copy follows docs/STYLE_GUIDE.md: short, warm, kid-readable.

type Attrs = Record<string, string>;

/** Builds an element. Text always goes in as text, never as HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

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
  /** Resolves to a problem to show, or null on success. */
  onSubmit: (values: Record<string, string>) => Promise<FormProblem | null>;
  links: { label: string; onClick: () => void; testId: string }[];
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

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
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

function messageOf(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Oops, something went wobbly. Try again!';
}

export interface AuthOverlayOptions {
  /** Called whenever the player logs in or out. */
  onChange?: (user: PublicUser | null) => void;
}

/**
 * Shows the welcome / sign-up / log-in screens until the player is logged in,
 * then a small "Hi, name!" chip with a log-out button.
 */
export function mountAuth(root: HTMLElement, options: AuthOverlayOptions = {}): void {
  const overlay = el('div', { class: 'auth-overlay', 'data-testid': 'auth-overlay' });
  overlay.hidden = true;
  const card = el('div', { class: 'auth-card', role: 'dialog', 'aria-modal': 'true' });
  overlay.append(card);

  const chipName = el('span', { class: 'auth-chip-name', 'data-testid': 'auth-user' });
  const chipStatus = el('span', { class: 'auth-chip-status', role: 'status' });
  const logoutButton = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-small' },
    'Log out',
  );
  const chip = el('div', { class: 'auth-chip' }, chipName, chipStatus, logoutButton);
  chip.hidden = true;
  root.append(overlay, chip);

  const showCard = (...children: Node[]) => {
    card.replaceChildren(...children);
    overlay.hidden = false;
    chip.hidden = true;
  };

  const signedIn = (user: PublicUser) => {
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
      el('h1', { class: 'auth-title' }, spec.title),
      el('p', { class: 'auth-subtitle' }, spec.subtitle),
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
    for (const link of spec.links) {
      const button = el(
        'button',
        { type: 'button', class: 'auth-link', 'data-testid': link.testId },
        link.label,
      );
      button.addEventListener('click', link.onClick);
      form.append(button);
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
    login.addEventListener('click', showLogin);
    signup.addEventListener('click', showSignup);
    showCard(
      el('h1', { class: 'auth-title' }, 'Welcome to Heartpatch!'),
      el('p', { class: 'auth-subtitle' }, 'The squishies have missed you.'),
      ...(notice ? [el('p', { class: 'auth-error', role: 'alert' }, notice)] : []),
      el('div', { class: 'auth-actions' }, login, signup),
    );
    login.focus();
  }

  function showLogin(): void {
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
          { label: 'Forgot your password?', onClick: showRecover, testId: 'auth-to-recover' },
          { label: 'New here? Sign up', onClick: showSignup, testId: 'auth-to-signup' },
        ],
      }),
    );
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
            label: 'Family code',
            hint: 'A grown-up has this.',
            input: textInput({ autocomplete: 'off' }),
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
          showRecoveryCode(result.user, result.recoveryCode, "Ta-da! You're in!");
          return null;
        },
        links: [{ label: 'Have an account? Log in', onClick: showLogin, testId: 'auth-to-login' }],
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
          showRecoveryCode(result.user, result.recoveryCode, 'All set! New password saved.');
          return null;
        },
        links: [{ label: 'Back to log in', onClick: showLogin, testId: 'auth-to-login' }],
      }),
    );
  }

  /** The code is shown once, so make saving it the obvious next step. */
  function showRecoveryCode(user: PublicUser, code: string, title: string): void {
    const done = el('button', { type: 'button', class: 'auth-button' }, 'I saved it!');
    done.addEventListener('click', () => {
      signedIn(user);
    });
    const copy = el('button', { type: 'button', class: 'auth-button auth-button-soft' }, 'Copy');
    copy.addEventListener('click', () => {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          copy.textContent = 'Copied!';
        })
        .catch(() => {
          copy.textContent = 'Write it down instead';
        });
    });
    showCard(
      el('h1', { class: 'auth-title' }, title),
      el('p', { class: 'auth-subtitle' }, "Here's your secret recovery code:"),
      el('p', { class: 'auth-code', 'data-testid': 'auth-recovery-code' }, code),
      el(
        'p',
        { class: 'auth-hint' },
        "Ask a grown-up to write it down somewhere safe. It's your way back in if you forget your password!",
      ),
      el('div', { class: 'auth-actions' }, done, ...('clipboard' in navigator ? [copy] : [])),
    );
    done.focus();
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
