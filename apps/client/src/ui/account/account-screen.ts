import type {
  AccountHelpersResponse,
  HelperCandidate,
  MemberPasswordResetResponse,
  PublicUser,
} from '@heartpatch/shared';
import { NewRecoveryCodeRequestSchema } from '@heartpatch/shared';
import { updateHold } from '../../pwa/update-hold.js';
import { reasonLine } from '../auth/auth-help-text.js';
import { saveCodePanel } from '../auth/save-code.js';
import { el, messageOf } from '../dom.js';
import { accountApi } from './account-api.js';
import { ACCOUNT_TEXT } from './account-text.js';
import './account.css';

// Grown-up helpers and new recovery codes (#197), from the approved mockup:
// Settings rows on both sides of a helper link, helper asks on the patch
// list, and their screens in a card over the lobby (like the log in card).

export interface AccountScreen {
  setUser: (user: PublicUser | null) => void;
  /** Rows on the lobby's Settings screen; they fill in once loaded. */
  settings: () => Node[];
  /** Helper asks, at the top of the patch list; empty when there are none. */
  listHeader: () => Node[];
}

export function mountAccount(root: HTMLElement): AccountScreen {
  const overlay = el('div', { class: 'auth-overlay', 'data-testid': 'account-overlay' });
  overlay.hidden = true;
  const card = el('div', {
    class: 'auth-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'account-title',
    tabindex: '-1',
  });
  overlay.append(card);
  root.append(overlay);

  let user: PublicUser | null = null;
  /** The Settings rows and patch-list asks on screen, redrawn after a change. */
  let settingsBox: HTMLElement | null = null;
  let asksBox: HTMLElement | null = null;
  /** Set while a one-time code is on screen (#47). */
  let releaseUpdates: (() => void) | null = null;

  const title = (text: string) => el('h1', { class: 'auth-title', id: 'account-title' }, text);
  const subtitle = (text: string) => el('p', { class: 'auth-subtitle' }, text);
  const hint = (text: string) => el('p', { class: 'auth-hint' }, text);
  const errorLine = () =>
    el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'account-error' });
  const button = (
    label: string,
    onClick: (b: HTMLButtonElement) => void,
    options: { soft?: boolean; small?: boolean; testId?: string } = {},
  ) => {
    const classes = ['auth-button'];
    if (options.soft) classes.push('auth-button-soft');
    if (options.small) classes.push('auth-button-small');
    const node = el(
      'button',
      {
        type: 'button',
        class: classes.join(' '),
        ...(options.testId ? { 'data-testid': options.testId } : {}),
      },
      label,
    );
    node.addEventListener('click', () => {
      onClick(node);
    });
    return node;
  };

  /** Runs an action once at a time, showing its problem on `status`. */
  const act = (status: HTMLElement, trigger: HTMLButtonElement, fn: () => Promise<void>) => {
    if (trigger.disabled) return;
    trigger.disabled = true;
    status.textContent = '';
    fn()
      .catch((err: unknown) => {
        status.textContent = messageOf(err);
      })
      .finally(() => {
        trigger.disabled = false;
      });
  };

  const letUpdatesThrough = () => {
    releaseUpdates?.();
    releaseUpdates = null;
  };

  const showCard = (...children: Node[]) => {
    letUpdatesThrough();
    card.replaceChildren(...children);
    overlay.hidden = false;
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
  };

  const close = () => {
    letUpdatesThrough();
    overlay.hidden = true;
    card.replaceChildren();
    redraw();
  };

  const backLink = (label: string = ACCOUNT_TEXT.back) => {
    const node = el('button', { type: 'button', class: 'auth-link' }, label);
    node.addEventListener('click', close);
    return node;
  };

  /** A yes/no card for anything that can't be undone (style guide §3.6). */
  const confirm = (spec: {
    title: string;
    body: string;
    yes: string;
    no: string;
    run: () => Promise<void>;
  }) => {
    const status = errorLine();
    showCard(
      title(spec.title),
      subtitle(spec.body),
      status,
      el(
        'div',
        { class: 'auth-actions' },
        button(spec.yes, (b) => {
          act(status, b, spec.run);
        }),
        button(spec.no, close, { soft: true }),
      ),
    );
  };

  // ---------- Settings rows ----------

  function redraw(): void {
    if (settingsBox?.isConnected) void fillSettings(settingsBox);
    if (asksBox?.isConnected) void fillAsks(asksBox);
  }

  async function fillSettings(box: HTMLElement): Promise<void> {
    let links: AccountHelpersResponse;
    try {
      links = await accountApi.helpers();
    } catch (err) {
      box.replaceChildren(el('p', { class: 'auth-error', role: 'alert' }, messageOf(err)));
      return;
    }
    if (box !== settingsBox) return;
    box.replaceChildren(...settingsRows(links));
  }

  function settingsRows(links: AccountHelpersResponse): Node[] {
    const rows: Node[] = [];
    if (links.helping.length > 0) {
      rows.push(
        el(
          'section',
          { class: 'lobby-section', 'data-testid': 'account-helping' },
          el('h2', { class: 'lobby-heading' }, ACCOUNT_TEXT.helpingHeading),
          el(
            'ul',
            { class: 'lobby-list' },
            ...links.helping.map((player) =>
              el(
                'li',
                { class: 'lobby-code' },
                el('span', { class: 'lobby-map-name' }, player.username),
                el(
                  'span',
                  { class: 'lobby-row' },
                  button(
                    `Help ${player.username}`,
                    () => {
                      showHelp(player);
                    },
                    { small: true },
                  ),
                  button(
                    ACCOUNT_TEXT.stopHelping,
                    () => {
                      confirm({
                        title: `Stop helping ${player.username}?`,
                        body: `You won't be able to reset ${player.username}'s password any more.`,
                        yes: ACCOUNT_TEXT.stopHelping,
                        no: ACCOUNT_TEXT.keepHelping,
                        run: async () => {
                          await accountApi.stopHelping(player.id);
                          close();
                        },
                      });
                    },
                    { soft: true, small: true },
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    const helpers = el('ul', { class: 'lobby-list' });
    for (const helper of links.helpers) {
      const active = helper.status === 'active';
      helpers.append(
        el(
          'li',
          { class: active ? 'lobby-code' : 'lobby-code lobby-code-ended' },
          el(
            'span',
            { class: 'lobby-code-top' },
            el(
              'span',
              { class: 'lobby-map-name' },
              helper.user.username,
              el(
                'span',
                {
                  class: active ? 'lobby-badge account-badge-ok' : 'lobby-badge lobby-badge-alert',
                },
                active ? ACCOUNT_TEXT.helperBadge : ACCOUNT_TEXT.waitingBadge,
              ),
            ),
            button(
              ACCOUNT_TEXT.remove,
              () => {
                confirm({
                  title: `Remove ${helper.user.username}?`,
                  body: active
                    ? `${helper.user.username} won't be able to reset your password any more.`
                    : `Your ask to ${helper.user.username} goes away.`,
                  yes: ACCOUNT_TEXT.remove,
                  no: `Keep ${helper.user.username}`,
                  run: async () => {
                    await accountApi.removeHelper(helper.user.id);
                    close();
                  },
                });
              },
              { soft: true, small: true },
            ),
          ),
          el(
            'span',
            { class: 'lobby-map-meta' },
            active ? ACCOUNT_TEXT.helperCan : `Waiting for ${helper.user.username} to say yes.`,
          ),
        ),
      );
    }
    rows.push(
      el(
        'section',
        { class: 'lobby-section', 'data-testid': 'account-helpers' },
        el('h2', { class: 'lobby-heading' }, ACCOUNT_TEXT.helpersHeading),
        ...(links.helpers.length > 0 ? [helpers] : [hint(ACCOUNT_TEXT.noHelper)]),
        ...(links.canAddHelper
          ? [
              el(
                'div',
                { class: 'lobby-row' },
                button(ACCOUNT_TEXT.addHelper, () => void showAdd(), {
                  soft: true,
                  small: true,
                  testId: 'account-add-helper',
                }),
              ),
            ]
          : []),
      ),
      el(
        'section',
        { class: 'lobby-section', 'data-testid': 'account-recovery' },
        el('h2', { class: 'lobby-heading' }, ACCOUNT_TEXT.codeHeading),
        hint(ACCOUNT_TEXT.codeHint),
        el(
          'div',
          { class: 'lobby-row' },
          button(ACCOUNT_TEXT.newCode, showNewCode, { small: true, testId: 'account-new-code' }),
        ),
      ),
    );
    return rows;
  }

  // ---------- Helper asks on the patch list ----------

  async function fillAsks(box: HTMLElement): Promise<void> {
    let asks: PublicUser[];
    try {
      asks = (await accountApi.helpers()).asks;
    } catch {
      return; // the patch list matters more; the asks show next time
    }
    if (box !== asksBox) return;
    if (asks.length === 0) {
      box.replaceChildren();
      return;
    }
    const status = errorLine();
    const answer = (verb: 'accept' | 'decline', player: PublicUser) => (b: HTMLButtonElement) => {
      act(status, b, async () => {
        await (verb === 'accept' ? accountApi.accept(player.id) : accountApi.decline(player.id));
        await fillAsks(box);
      });
    };
    box.replaceChildren(
      el(
        'section',
        { class: 'lobby-section account-asks', 'data-testid': 'account-asks' },
        el(
          'h2',
          { class: 'lobby-heading' },
          ACCOUNT_TEXT.asksHeading,
          ' ',
          el('span', { class: 'lobby-badge lobby-badge-alert' }, String(asks.length)),
        ),
        el(
          'ul',
          { class: 'lobby-list' },
          ...asks.map((player) =>
            el(
              'li',
              { class: 'lobby-code' },
              el(
                'span',
                { class: 'lobby-map-name' },
                `${player.username} wants you as their helper`,
              ),
              el('span', { class: 'lobby-map-meta' }, ACCOUNT_TEXT.askMeta),
              el(
                'span',
                { class: 'lobby-row' },
                button(ACCOUNT_TEXT.sayYes, answer('accept', player), { small: true }),
                button(ACCOUNT_TEXT.noThanks, answer('decline', player), {
                  soft: true,
                  small: true,
                }),
              ),
            ),
          ),
        ),
        status,
      ),
    );
  }

  // ---------- Screens ----------

  async function showAdd(): Promise<void> {
    showCard(title(ACCOUNT_TEXT.addTitle), subtitle(ACCOUNT_TEXT.oneMoment));
    let candidates: HelperCandidate[];
    try {
      candidates = await accountApi.candidates();
    } catch (err) {
      showCard(
        title(ACCOUNT_TEXT.addTitle),
        el('p', { class: 'auth-error', role: 'alert' }, messageOf(err)),
        backLink(),
      );
      return;
    }
    const first = candidates[0];
    if (!first) {
      showCard(title(ACCOUNT_TEXT.addTitle), subtitle(ACCOUNT_TEXT.nobody), backLink());
      return;
    }
    let picked = first;
    const status = errorLine();
    const ask = button(
      `Ask ${picked.user.username}`,
      (b) => {
        act(status, b, async () => {
          await accountApi.ask(picked.user.id);
          close();
        });
      },
      { testId: 'account-ask' },
    );
    const choices = candidates.map((candidate) => {
      const choice = el(
        'button',
        {
          type: 'button',
          class: 'lobby-choice',
          role: 'radio',
          'aria-checked': candidate === picked ? 'true' : 'false',
        },
        el('span', { class: 'lobby-choice-label' }, candidate.user.username),
        el(
          'span',
          { class: 'lobby-choice-hint' },
          reasonLine(candidate.reason, candidate.patchName),
        ),
      );
      choice.addEventListener('click', () => {
        picked = candidate;
        for (const c of choices) c.setAttribute('aria-checked', c === choice ? 'true' : 'false');
        ask.textContent = `Ask ${candidate.user.username}`;
      });
      return choice;
    });
    showCard(
      title(ACCOUNT_TEXT.addTitle),
      subtitle(ACCOUNT_TEXT.addSubtitle),
      el('div', { class: 'lobby-choices', role: 'radiogroup' }, ...choices),
      status,
      el('div', { class: 'auth-actions' }, ask),
      backLink(),
    );
  }

  function showNewCode(): void {
    const id = 'account-password';
    const input = el('input', {
      id,
      name: 'password',
      type: 'password',
      class: 'auth-input',
      autocomplete: 'current-password',
    });
    const status = errorLine();
    const submit = el('button', { type: 'submit', class: 'auth-button' }, ACCOUNT_TEXT.makeCode);
    const form = el(
      'form',
      { class: 'auth-form', novalidate: '' },
      title(ACCOUNT_TEXT.newCodeTitle),
      subtitle(ACCOUNT_TEXT.newCodeSubtitle),
      el(
        'div',
        { class: 'auth-field' },
        el('label', { for: id }, ACCOUNT_TEXT.yourPassword),
        input,
        hint(ACCOUNT_TEXT.oldCodeStops),
      ),
      status,
      submit,
      backLink(ACCOUNT_TEXT.notNow),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = NewRecoveryCodeRequestSchema.safeParse({ password: input.value });
      if (!parsed.success) {
        status.textContent = parsed.error.issues[0]?.message ?? '';
        input.focus();
        return;
      }
      act(status, submit, async () => {
        const code = await accountApi.newRecoveryCode(parsed.data.password);
        const me = user;
        if (!me) return;
        showCard(
          saveCodePanel({
            title: ACCOUNT_TEXT.newCodeReady,
            titleId: 'account-title',
            username: me.username,
            code,
            doneLabel: ACCOUNT_TEXT.done,
            onDone: close,
          }),
        );
        // Shown once: an automatic update must not reload it away (#47).
        releaseUpdates = updateHold.hold();
      });
    });
    showCard(form);
    input.focus();
  }

  /** "Help <name>": their name to read out, and a password reset. */
  function showHelp(player: PublicUser): void {
    showCard(
      title(`Help ${player.username}`),
      subtitle(ACCOUNT_TEXT.theirName),
      el('p', { class: 'account-bigname', 'data-testid': 'account-their-name' }, player.username),
      el('p', { class: 'auth-hint auth-center' }, ACCOUNT_TEXT.anyCase),
      el(
        'section',
        { class: 'lobby-section' },
        el('h2', { class: 'lobby-heading' }, ACCOUNT_TEXT.forgotTheirs),
        hint(
          `${player.username} gets logged out everywhere. You'll see a new password and recovery code to give them.`,
        ),
        button(
          ACCOUNT_TEXT.resetPassword,
          () => {
            confirm({
              title: `Reset ${player.username}'s password?`,
              body: `${player.username} gets logged out everywhere. You'll see a new password and recovery code to give them.`,
              yes: ACCOUNT_TEXT.reset,
              no: ACCOUNT_TEXT.notNow,
              run: async () => {
                showReset(await accountApi.resetPassword(player.id));
              },
            });
          },
          { testId: 'account-reset' },
        ),
      ),
      backLink(),
    );
  }

  /** Shown once; the server keeps only hashes (like the owner's reset). */
  function showReset(result: MemberPasswordResetResponse): void {
    showCard(
      title(ACCOUNT_TEXT.resetReady),
      subtitle(`Give these to ${result.user.username}. You'll only see them once!`),
      hint(ACCOUNT_TEXT.password),
      el(
        'p',
        { class: 'auth-code', 'data-testid': 'account-temp-password' },
        result.temporaryPassword,
      ),
      hint(ACCOUNT_TEXT.recoveryCode),
      el('p', { class: 'auth-code', 'data-testid': 'account-recovery-code' }, result.recoveryCode),
      hint(ACCOUNT_TEXT.resetHowTo),
      el('div', { class: 'auth-actions' }, button(ACCOUNT_TEXT.done, close)),
    );
    // Shown once: an automatic update must not reload it away (#47).
    releaseUpdates = updateHold.hold();
  }

  return {
    setUser: (next) => {
      user = next;
      if (!next && !overlay.hidden) close();
    },
    settings: () => {
      if (!user) return [];
      settingsBox = el('div', { class: 'account-settings' }, hint(ACCOUNT_TEXT.oneMoment));
      void fillSettings(settingsBox);
      return [settingsBox];
    },
    listHeader: () => {
      if (!user) return [];
      asksBox = el('div', { class: 'account-asks-box' });
      void fillAsks(asksBox);
      return [asksBox];
    },
  };
}
