import {
  ADMIN_IDLE_MINUTES,
  type AdminAuditResponse,
  type AdminMeResponse,
  type AdminPatchDetail,
  type AdminPlayerDetail,
} from '@heartpatch/shared';
import { ApiRequestError } from '../net/api.js';
import { el, messageOf } from '../ui/dom.js';
import { adminApi } from './admin-api.js';
import {
  actionLabel,
  age,
  ago,
  auditTarget,
  codeStatusLabel,
  countdown,
  dateTime,
  lastWeek,
  nightLabel,
  patchStatusLabel,
  plural,
  pvpLabel,
  shortDate,
  waitingLong,
} from './admin-format.js';

// The operator admin console (#196, mockup approved 2026-10-07): a plain DOM
// page, not the game canvas. The server is the gate; this page only shows
// sign-in when the server says there's no admin session.

type View = 'patches' | 'players' | 'codes' | 'lookup' | 'audit';

const VIEWS: readonly [View, string][] = [
  ['patches', 'Patches'],
  ['players', 'Players'],
  ['codes', 'Family codes'],
  ['lookup', 'Find a username'],
  ['audit', 'Audit log'],
];

const AUDIT_NOTE = 'This is written to the audit log with your name and the time.';

interface State {
  me: AdminMeResponse | null;
  view: View;
  q: string;
  page: number;
  tutorial: boolean;
  selectedPatch: string | null;
  selectedPlayer: string | null;
}

export function startAdmin(root: HTMLElement): void {
  const state: State = {
    me: null,
    view: 'patches',
    q: '',
    page: 1,
    tutorial: false,
    selectedPatch: null,
    selectedPlayer: null,
  };
  const now = () => new Date();

  const main = el('main', { class: 'adm-main', id: 'adm-main' });
  const toastEl = el('div', { class: 'adm-toast', role: 'status', hidden: '' });
  const scrim = el('div', { class: 'adm-scrim', hidden: '' });
  const dialogEl = el('div', {
    class: 'adm-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'adm-dialog-title',
  });
  scrim.append(dialogEl);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) closeDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.hidden) closeDialog();
  });

  let toastTimer = 0;
  const toast = (message: string) => {
    toastEl.textContent = message;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3000);
  };

  // --- Session ------------------------------------------------------------

  const timer = el('span', { class: 'adm-timer', id: 'adm-timer' }, '30:00');
  /** Each successful call touched the session on the server; follow it here. */
  const touched = () => {
    if (state.me) {
      state.me = {
        ...state.me,
        idleExpiresAt: new Date(now().getTime() + ADMIN_IDLE_MINUTES * 60_000).toISOString(),
      };
    }
  };
  window.setInterval(() => {
    if (!state.me) return;
    const until =
      Date.parse(state.me.idleExpiresAt) < Date.parse(state.me.expiresAt)
        ? state.me.idleExpiresAt
        : state.me.expiresAt;
    timer.textContent = countdown(until, now());
    if (Date.parse(until) <= now().getTime()) showLogin('Signed out after 30 quiet minutes.');
  }, 1000);

  /** Runs a call; a missing admin session sends you back to sign-in. */
  async function call<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await fn();
      touched();
      return result;
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'FORBIDDEN') {
        showLogin('Your admin session ended. Sign in again.');
        return undefined;
      }
      throw err;
    }
  }

  /** Runs an action from a dialog: errors show in the dialog and a toast. */
  async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await call(fn);
    } catch (err) {
      closeDialog();
      toast(messageOf(err));
      return undefined;
    }
  }

  // --- Dialogs ------------------------------------------------------------

  function closeDialog() {
    scrim.hidden = true;
    dialogEl.replaceChildren();
  }

  function openDialog(...children: Node[]) {
    dialogEl.replaceChildren(...children);
    scrim.hidden = false;
    const focus = dialogEl.querySelector<HTMLElement>('[data-autofocus], button');
    focus?.focus();
  }

  /** A confirm step for anything that changes something (style guide §3.6). */
  function confirmAction(options: {
    title: string;
    body: (Node | string)[];
    list?: string[];
    ok: string;
    danger?: boolean;
    run: () => Promise<void>;
  }) {
    const okButton = el(
      'button',
      { class: `adm-btn ${options.danger ? 'danger' : 'primary'}`, 'data-autofocus': '' },
      options.ok,
    );
    const cancel = el('button', { class: 'adm-btn' }, 'Cancel');
    cancel.addEventListener('click', closeDialog);
    okButton.addEventListener('click', () => {
      okButton.disabled = true;
      cancel.disabled = true;
      void options.run().finally(() => {
        okButton.disabled = false;
        cancel.disabled = false;
      });
    });
    openDialog(
      el('h2', { id: 'adm-dialog-title' }, options.title),
      el('p', {}, ...options.body),
      ...(options.list ? [el('ul', {}, ...options.list.map((l) => el('li', {}, l)))] : []),
      el('p', { class: 'adm-hint' }, AUDIT_NOTE),
      el('div', { class: 'adm-actions end' }, cancel, okButton),
    );
  }

  /** Secrets, shown once, then gone when the dialog closes. */
  function showSecrets(
    title: string,
    intro: string,
    rows: [string, string][],
    after: string,
    done: string,
  ) {
    const close = el('button', { class: 'adm-btn primary', 'data-autofocus': '' }, done);
    close.addEventListener('click', () => {
      closeDialog();
      render();
    });
    openDialog(
      el('h2', { id: 'adm-dialog-title' }, title),
      el('p', {}, intro),
      el(
        'div',
        { class: 'adm-secret' },
        ...rows.map(([label, value]) =>
          el(
            'div',
            {},
            el('span', {}, label),
            el('span', { class: 'mono', 'data-secret': '' }, value),
          ),
        ),
      ),
      el('p', { class: 'adm-hint' }, after),
      el('div', { class: 'adm-actions end' }, close),
    );
  }

  // --- Sign-in --------------------------------------------------------------

  function showLogin(notice?: string) {
    state.me = null;
    closeDialog();
    const username = el('input', {
      id: 'adm-username',
      autocomplete: 'username',
      required: '',
      autocapitalize: 'off',
    });
    const password = el('input', {
      id: 'adm-password',
      type: 'password',
      autocomplete: 'current-password',
      required: '',
    });
    const code = el('input', {
      id: 'adm-code',
      class: 'adm-totp',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      maxlength: '7',
      placeholder: '000000',
      required: '',
    });
    const error = el('p', { class: 'adm-error', role: 'alert', hidden: '' });
    const submit = el('button', { class: 'adm-btn primary', type: 'submit' }, 'Sign in');
    const form = el(
      'form',
      { class: 'adm-login-card' },
      el('h1', { class: 'adm-brand' }, 'Heartpatch', el('small', {}, 'Admin console')),
      ...(notice ? [el('p', { class: 'adm-notice' }, notice)] : []),
      field('Username', username),
      field('Password', password),
      field('6-digit code from your authenticator app', code),
      error,
      submit,
      el(
        'p',
        { class: 'adm-hint' },
        'Needed on every sign-in. A session ends after 30 minutes without a click and never lasts more than 8 hours. The authenticator is set up on the server, never here.',
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.hidden = true;
      adminApi
        .login({ username: username.value, password: password.value, code: code.value })
        .then((me) => {
          state.me = me;
          showConsole();
        })
        .catch((err: unknown) => {
          error.textContent = messageOf(err);
          error.hidden = false;
          code.value = '';
          code.focus();
        })
        .finally(() => (submit.disabled = false));
    });
    root.replaceChildren(el('section', { class: 'adm-login' }, form), toastEl);
    username.focus();
  }

  function field(label: string, input: HTMLInputElement | HTMLSelectElement): HTMLElement {
    return el('div', { class: 'adm-field' }, el('label', { for: input.id }, label), input);
  }

  // --- Console shell ----------------------------------------------------------

  const rail = el('nav', { class: 'adm-rail', 'aria-label': 'Sections' });
  const who = el('strong', {});

  function showConsole() {
    const signOut = el('button', { class: 'adm-btn small' }, 'Sign out');
    signOut.addEventListener('click', () => {
      void adminApi.logout().finally(() => {
        showLogin('Signed out.');
      });
    });
    who.textContent = state.me?.admin.username ?? '';
    rail.replaceChildren(
      ...VIEWS.map(([view, label]) => {
        const button = el('button', { 'data-view': view }, label);
        button.addEventListener('click', () => {
          go(view);
        });
        return button;
      }),
    );
    root.replaceChildren(
      el(
        'header',
        { class: 'adm-top' },
        el('p', { class: 'adm-brand' }, 'Heartpatch', el('small', {}, 'Admin')),
        el(
          'div',
          { class: 'adm-session' },
          el('span', {}, 'Signed in as ', who),
          el('span', {}, 'Idle sign-out in ', timer),
          signOut,
        ),
      ),
      el('div', { class: 'adm-shell' }, rail, main),
      scrim,
      toastEl,
    );
    go(state.view);
  }

  function go(view: View) {
    state.view = view;
    state.q = '';
    state.page = 1;
    for (const button of rail.querySelectorAll<HTMLButtonElement>('button')) {
      if (button.dataset['view'] === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    render();
  }

  let renderSeq = 0;
  function render() {
    const seq = (renderSeq += 1);
    const current = () => seq === renderSeq;
    const views: Record<View, () => Promise<void>> = {
      patches: () => renderPatches(current),
      players: () => renderPlayers(current),
      codes: () => renderCodes(current),
      lookup: () => {
        renderLookup();
        return Promise.resolve();
      },
      audit: () => renderAudit(current),
    };
    views[state.view]().catch((err: unknown) => {
      if (current()) main.replaceChildren(el('p', { class: 'adm-error' }, messageOf(err)));
    });
  }

  // --- Shared pieces --------------------------------------------------------

  function head(title: string, intro: string, ...tools: Node[]): HTMLElement {
    return el(
      'div',
      { class: 'adm-head' },
      el('div', {}, el('h1', {}, title), el('p', {}, intro)),
      el('div', { class: 'adm-tools' }, ...tools),
    );
  }

  /** A search box that re-renders as you type (debounced). */
  function search(placeholder: string, label: string): HTMLInputElement {
    const input = el('input', {
      class: 'adm-search',
      id: 'adm-search',
      type: 'search',
      placeholder,
      'aria-label': label,
    });
    input.value = state.q;
    let timerId = 0;
    input.addEventListener('input', () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        state.q = input.value.trim();
        state.page = 1;
        // A new search picks its own first row.
        state.selectedPatch = null;
        state.selectedPlayer = null;
        render();
      }, 250);
    });
    return input;
  }

  function pager(page: number, pageSize: number, total: number): HTMLElement {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const prev = el('button', { class: 'adm-btn small' }, 'Previous');
    const next = el('button', { class: 'adm-btn small' }, 'Next');
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    prev.addEventListener('click', () => {
      state.page = page - 1;
      render();
    });
    next.addEventListener('click', () => {
      state.page = page + 1;
      render();
    });
    return el(
      'div',
      { class: 'adm-pager' },
      el('span', {}, `${plural(total, 'result')} · page ${String(page)} of ${String(pages)}`),
      el('div', { class: 'adm-actions' }, prev, next),
    );
  }

  /** A table whose rows open a detail panel, by keyboard too. */
  function table(
    headers: string[],
    rows: { id?: string; selected?: boolean; cells: (Node | string)[]; open?: () => void }[],
    footer?: HTMLElement,
  ): HTMLElement {
    const body = el('tbody');
    for (const row of rows) {
      const tr = el('tr', row.open ? { class: 'row', tabindex: '0' } : {});
      if (row.open) {
        tr.setAttribute('aria-selected', String(row.selected === true));
        const open = row.open;
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        });
      }
      tr.append(...row.cells.map((c) => el('td', {}, c)));
      body.append(tr);
    }
    if (rows.length === 0) {
      body.append(
        el(
          'tr',
          {},
          el('td', { colspan: String(headers.length), class: 'adm-empty' }, 'Nothing matches.'),
        ),
      );
    }
    return el(
      'div',
      { class: 'adm-tablewrap' },
      el('table', {}, el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h)))), body),
      ...(footer ? [footer] : []),
    );
  }

  const pill = (text: string, tone = '') => el('span', { class: `adm-pill ${tone}` }, text);
  const sub = (text: string) => el('span', { class: 'adm-sub' }, text);
  const strong = (text: string) => el('strong', {}, text);

  // --- Patches ----------------------------------------------------------------

  async function renderPatches(current: () => boolean) {
    const list = await call(() => adminApi.patches(state.q, state.page, state.tutorial));
    if (!list || !current()) return;
    const selected =
      list.patches.find((p) => p.id === state.selectedPatch)?.id ?? list.patches[0]?.id ?? null;
    state.selectedPatch = selected;
    const tutorial = el('input', { type: 'checkbox', id: 'adm-tutorial' });
    tutorial.checked = state.tutorial;
    tutorial.addEventListener('change', () => {
      state.tutorial = tutorial.checked;
      state.page = 1;
      render();
    });
    const panel = el('section', { class: 'adm-panel', 'aria-live': 'polite' });
    main.replaceChildren(
      head(
        'Patches',
        "Every patch in progress. Pick one to see who's in it, who's waiting, and its invite code.",
        search('Search patch or owner', 'Search patches'),
        el('label', { class: 'adm-check' }, tutorial, 'Show tutorial runs'),
      ),
      el(
        'div',
        { class: 'adm-split' },
        table(
          ['Patch', 'Players', 'Last activity', 'PvP', 'Waiting'],
          list.patches.map((p) => ({
            selected: p.id === selected,
            open: () => {
              state.selectedPatch = p.id;
              render();
            },
            cells: [
              el(
                'span',
                {},
                strong(p.name),
                ...(p.kind === 'tutorial' ? [' ', pill('tutorial')] : []),
                sub(
                  [
                    `owner ${p.owner ?? '—'}`,
                    `made ${shortDate(p.createdAt)}`,
                    ...(p.seasons.length > 0 ? [p.seasons.join(', ')] : []),
                  ].join(' · '),
                ),
              ),
              `${String(p.members)} / ${String(p.maxPlayers)}`,
              ago(p.lastActivityAt, now()),
              p.kind === 'tutorial' ? '—' : pvpLabel(p.pvpMode),
              p.pendingRequests > 0
                ? pill(plural(p.pendingRequests, 'request'), 'warn')
                : el('span', { class: 'adm-muted' }, '—'),
            ],
          })),
          pager(list.page, list.pageSize, list.total),
        ),
        panel,
      ),
    );
    if (selected) await renderPatchPanel(panel, selected, current);
    else panel.append(el('p', { class: 'adm-empty' }, 'No patch matches.'));
  }

  async function renderPatchPanel(panel: HTMLElement, mapId: string, current: () => boolean) {
    const detail = await call(() => adminApi.patch(mapId));
    if (!detail || !current()) return;
    const { patch } = detail;
    const isTutorial = patch.kind === 'tutorial';
    panel.replaceChildren(
      el(
        'div',
        {},
        el('h2', {}, patch.name),
        el(
          'span',
          { class: 'adm-muted' },
          `${isTutorial ? 'Tutorial run' : 'Patch'} · time zone ${patch.timeZone}`,
        ),
      ),
      el(
        'dl',
        { class: 'adm-facts' },
        fact('Owner', patch.owner ?? '—'),
        fact('Players', `${String(patch.members)} of ${String(patch.maxPlayers)} seats`),
        fact('PvP mode', isTutorial ? '—' : pvpLabel(patch.pvpMode)),
        fact('Made', shortDate(patch.createdAt)),
      ),
      section('Players', membersList(detail)),
      ...(isTutorial ? [] : [section('Waiting to join', requestsList(detail))]),
      section('Invite code', inviteBox(detail)),
      section('Recent nights', nightsList(detail)),
    );
  }

  function fact(label: string, value: string): HTMLElement {
    return el('div', {}, el('dt', {}, label), el('dd', {}, value));
  }

  function section(title: string, ...children: Node[]): HTMLElement {
    return el('div', {}, el('h3', {}, title), ...children);
  }

  function openPlayer(userId: string) {
    state.selectedPlayer = userId;
    go('players');
  }

  function membersList(detail: AdminPatchDetail): HTMLElement {
    if (detail.members.length === 0) return el('p', { class: 'adm-empty' }, 'Nobody is in it.');
    return el(
      'div',
      { class: 'adm-list' },
      ...detail.members.map((m) => {
        const open = el('button', { class: 'adm-btn small' }, 'Open player');
        open.addEventListener('click', () => {
          openPlayer(m.userId);
        });
        return el(
          'div',
          { class: 'adm-li' },
          el(
            'div',
            { class: 'grow' },
            strong(m.username),
            ...(m.role === 'owner' ? [' ', pill('owner', 'accent')] : []),
            sub(`joined ${shortDate(m.joinedAt)} · last played here ${ago(m.lastActiveAt, now())}`),
          ),
          open,
        );
      }),
    );
  }

  function requestsList(detail: AdminPatchDetail): HTMLElement {
    if (detail.requests.length === 0) return el('p', { class: 'adm-empty' }, 'Nobody is waiting.');
    const { patch } = detail;
    return el(
      'div',
      {},
      el(
        'div',
        { class: 'adm-list' },
        ...detail.requests.map((r) => {
          const approve = el('button', { class: 'adm-btn small' }, 'Approve');
          const decline = el('button', { class: 'adm-btn small danger' }, 'Decline');
          approve.addEventListener('click', () => {
            confirmAction({
              title: `Let ${r.username} in?`,
              body: [
                strong(r.username),
                ' joins ',
                strong(patch.name),
                ' and gets a free home base.',
              ],
              ok: 'Approve',
              run: async () => {
                if ((await act(() => adminApi.answer(patch.id, r.id, 'approve'))) === undefined) {
                  return;
                }
                closeDialog();
                toast('Approved. They can play now.');
                render();
              },
            });
          });
          decline.addEventListener('click', () => {
            confirmAction({
              title: `Decline ${r.username}?`,
              body: [
                'Their request to join ',
                strong(patch.name),
                ' is closed. They can ask again with a code.',
              ],
              ok: 'Decline',
              danger: true,
              run: async () => {
                if ((await act(() => adminApi.answer(patch.id, r.id, 'decline'))) === undefined) {
                  return;
                }
                closeDialog();
                toast('Declined.');
                render();
              },
            });
          });
          const waited = sub(`asked ${age(r.createdAt, now())} ago`);
          if (waitingLong(r.createdAt, now())) {
            waited.append(' · ', el('span', { class: 'adm-warn' }, 'waiting a while'));
          }
          return el(
            'div',
            { class: 'adm-li' },
            el('div', { class: 'grow' }, strong(r.username), waited),
            el('div', { class: 'adm-actions' }, approve, decline),
          );
        }),
      ),
      el(
        'p',
        { class: 'adm-callout' },
        "Approve works only while a seat is free, the same rule the owner's page uses.",
      ),
    );
  }

  function inviteBox(detail: AdminPatchDetail): HTMLElement {
    const { patch } = detail;
    if (patch.kind === 'tutorial') {
      return el('p', { class: 'adm-empty' }, 'Tutorial runs have no invite code.');
    }
    const make = el(
      'button',
      { class: 'adm-btn small' },
      detail.invite ? 'New code' : 'Make a code',
    );
    make.addEventListener('click', () => {
      confirmAction({
        title: detail.invite ? 'Make a new invite code?' : 'Make an invite code?',
        body: detail.invite
          ? [
              'The old code for ',
              strong(patch.name),
              ' stops working. Requests already waiting stay.',
            ]
          : ['A new code for ', strong(patch.name), ' that works for 7 days.'],
        ok: 'Make code',
        run: async () => {
          const invite = await act(() => adminApi.newInvite(patch.id));
          if (!invite) return;
          showSecrets(
            `New invite code for ${patch.name}`,
            'Share it with the family. It asks the owner to let them in.',
            [['Invite code', invite.code]],
            `Works until ${dateTime(invite.expiresAt)}.`,
            'Done',
          );
        },
      });
    });
    if (!detail.invite) {
      return el(
        'div',
        { class: 'adm-code-box' },
        el('span', { class: 'adm-muted grow' }, 'No live code.'),
        make,
      );
    }
    const code = el('span', { class: 'adm-code', id: 'adm-invite' }, '••••-••••');
    const reveal = el('button', { class: 'adm-btn small' }, 'Show code');
    reveal.addEventListener('click', () => {
      confirmAction({
        title: 'Show the invite code?',
        body: ['The code for ', strong(patch.name), ' appears here until you leave this patch.'],
        ok: 'Show code',
        run: async () => {
          const invite = await act(() => adminApi.revealInvite(patch.id));
          if (!invite) return;
          code.textContent = invite.code;
          reveal.disabled = true;
          closeDialog();
        },
      });
    });
    return el(
      'div',
      { class: 'adm-code-box' },
      code,
      el('span', { class: 'adm-muted grow' }, `works until ${dateTime(detail.invite.expiresAt)}`),
      el('div', { class: 'adm-actions' }, reveal, make),
    );
  }

  function nightsList(detail: AdminPatchDetail): HTMLElement {
    if (detail.nights.length === 0) return el('p', { class: 'adm-empty' }, 'No nightfall yet.');
    return el(
      'div',
      { class: 'adm-list' },
      ...detail.nights.map((n) => {
        const taken = n.players.filter((p) => p.taken).map((p) => p.username);
        const sheltered = n.players.reduce((sum, p) => sum + p.sheltered, 0);
        const text =
          taken.length > 0
            ? `${plural(sheltered, 'squishy', 'squishies')} safe; taken from ${taken.join(', ')}`
            : n.players.length > 0
              ? 'Everyone safe'
              : 'Nobody to visit';
        return el(
          'div',
          { class: 'adm-li' },
          el('span', { class: 'adm-night' }, nightLabel(n.night)),
          el('span', { class: 'grow' }, text),
        );
      }),
    );
  }

  // --- Players ------------------------------------------------------------------

  async function renderPlayers(current: () => boolean) {
    const list = await call(() => adminApi.players(state.q, state.page));
    if (!list || !current()) return;
    const selected = state.selectedPlayer ?? list.players[0]?.id ?? null;
    state.selectedPlayer = selected;
    const panel = el('section', { class: 'adm-panel', 'aria-live': 'polite' });
    main.replaceChildren(
      head(
        'Players',
        'Every account. Passwords and recovery codes are never shown; only whether a recovery code is waiting to be used.',
        search('Search username', 'Search players'),
      ),
      el(
        'div',
        { class: 'adm-split' },
        table(
          ['Player', 'Last sign-in', 'Devices', 'Recovery code'],
          list.players.map((p) => ({
            selected: p.id === selected,
            open: () => {
              state.selectedPlayer = p.id;
              render();
            },
            cells: [
              el(
                'span',
                {},
                strong(p.username),
                ...(p.role === 'admin' ? [' ', pill('admin', 'accent')] : []),
                sub(`made ${shortDate(p.createdAt)} · ${plural(p.patches, 'patch', 'patches')}`),
              ),
              p.lastSignInAt ? dateTime(p.lastSignInAt) : 'not signed in',
              String(p.activeSessions),
              p.hasRecoveryCode ? pill('has one', 'ok') : pill('none', 'warn'),
            ],
          })),
          pager(list.page, list.pageSize, list.total),
        ),
        panel,
      ),
    );
    if (selected) await renderPlayerPanel(panel, selected, current);
    else panel.append(el('p', { class: 'adm-empty' }, 'No player matches.'));
  }

  async function renderPlayerPanel(panel: HTMLElement, userId: string, current: () => boolean) {
    const detail = await call(() => adminApi.player(userId));
    if (!detail || !current()) return;
    const { player } = detail;
    const reset = el('button', { class: 'adm-btn', id: 'adm-reset' }, 'Reset password');
    const logout = el(
      'button',
      { class: 'adm-btn danger', id: 'adm-logout-all' },
      'Log out everywhere',
    );
    reset.addEventListener('click', () => {
      confirmAction({
        title: `Reset ${player.username}'s password?`,
        body: ['This will:'],
        list: [
          'set a temporary password',
          'replace their recovery code with a new one',
          `log them out on ${player.activeSessions === 1 ? 'their 1 signed-in device' : `all ${String(player.activeSessions)} signed-in devices`}`,
        ],
        ok: 'Reset password',
        danger: true,
        run: async () => {
          const result = await act(() => adminApi.resetPassword(userId));
          if (!result) return;
          showSecrets(
            `Give these to ${result.username}`,
            'Shown only now. Write them down or read them out, then close this.',
            [
              ['Temporary password', result.temporaryPassword],
              ['New recovery code', result.recoveryCode],
            ],
            'They sign in with the temporary password, or pick their own with "Forgot your password?" and the new recovery code.',
            "I've passed them on",
          );
        },
      });
    });
    logout.addEventListener('click', () => {
      confirmAction({
        title: `Log ${player.username} out everywhere?`,
        body: [
          "They'll need their password to sign back in on each device. Their password and squishies don't change.",
        ],
        ok: 'Log out everywhere',
        danger: true,
        run: async () => {
          const result = await act(() => adminApi.logoutEverywhere(userId));
          if (!result) return;
          closeDialog();
          toast(`${player.username} is logged out on ${plural(result.ended, 'device')}.`);
          render();
        },
      });
    });
    panel.replaceChildren(
      el(
        'div',
        {},
        el('h2', {}, player.username),
        el('span', { class: 'adm-muted' }, `Account made ${shortDate(player.createdAt)}`),
      ),
      el(
        'dl',
        { class: 'adm-facts' },
        fact('Brought in by', broughtInBy(detail)),
        fact('Last sign-in', player.lastSignInAt ? dateTime(player.lastSignInAt) : 'not signed in'),
        fact('Signed-in devices', String(player.activeSessions)),
        fact('Recovery code', player.hasRecoveryCode ? 'Has an unused one' : 'None waiting'),
      ),
      section(
        'Patches',
        detail.patches.length === 0
          ? el('p', { class: 'adm-empty' }, 'Not in any patch.')
          : el(
              'div',
              { class: 'adm-list' },
              ...detail.patches.map((p) =>
                el(
                  'div',
                  { class: 'adm-li' },
                  el(
                    'span',
                    { class: 'grow' },
                    strong(p.name),
                    sub(`${patchStatusLabel(p.status)} since ${shortDate(p.since)}`),
                  ),
                ),
              ),
            ),
      ),
      section(
        'Help with this account',
        el('div', { class: 'adm-actions' }, reset, logout),
        el(
          'p',
          { class: 'adm-callout' },
          "Reset gives a temporary password and a new recovery code, shown once, and logs them out on every device. It's the same reset as the server script.",
        ),
      ),
    );
  }

  function broughtInBy(detail: AdminPlayerDetail): string {
    const { signupCodeLabel, invitedBy } = detail.broughtInBy;
    if (signupCodeLabel && invitedBy) return `${invitedBy} (family code "${signupCodeLabel}")`;
    if (signupCodeLabel) return `Family code "${signupCodeLabel}"`;
    if (invitedBy) return `Invited by ${invitedBy}`;
    return 'An operator code, or before family codes';
  }

  // --- Family codes ---------------------------------------------------------------

  async function renderCodes(current: () => boolean) {
    const list = await call(() => adminApi.signupCodes());
    if (!list || !current()) return;
    const make = el('button', { class: 'adm-btn primary' }, 'Make a family code');
    make.addEventListener('click', makeCodeDialog);
    const tone: Record<string, string> = { live: 'ok', revoked: 'bad' };
    main.replaceChildren(
      head(
        'Family codes',
        "Codes that let a new family make accounts. Yours have no cap; patch owners can have 3 live at once. A code is shown once when it's made.",
        make,
      ),
      table(
        ['Label', 'Made by', 'Used', 'Works until', 'Status', ''],
        list.codes.map((c) => {
          const actions = el('div', { class: 'adm-actions' });
          if (c.status === 'live' || c.status === 'expired') {
            const extend = el('button', { class: 'adm-btn small' }, 'Extend 7 days');
            extend.addEventListener('click', () => {
              confirmAction({
                title: `Extend "${c.label}"?`,
                body: ['It keeps working for 7 more days.'],
                ok: 'Extend',
                run: async () => {
                  if ((await act(() => adminApi.extendSignupCode(c.id, 7))) === undefined) return;
                  closeDialog();
                  toast('Extended.');
                  render();
                },
              });
            });
            actions.append(extend);
          }
          if (c.status !== 'revoked') {
            const off = el('button', { class: 'adm-btn small danger' }, 'Turn off');
            off.addEventListener('click', () => {
              confirmAction({
                title: `Turn off "${c.label}"?`,
                body: ['Nobody new can sign up with it. Accounts already made with it stay.'],
                ok: 'Turn off',
                danger: true,
                run: async () => {
                  if ((await act(() => adminApi.revokeSignupCode(c.id))) === undefined) return;
                  closeDialog();
                  toast('Turned off.');
                  render();
                },
              });
            });
            actions.append(off);
          }
          return {
            cells: [
              el(
                'span',
                {},
                strong(c.label),
                ...(c.usedBy.length > 0 ? [sub(`used by ${c.usedBy.join(', ')}`)] : []),
              ),
              c.createdBy ?? 'Operator',
              `${String(c.uses)} / ${String(c.maxUses)}`,
              shortDate(c.expiresAt),
              pill(codeStatusLabel(c.status), tone[c.status] ?? ''),
              actions,
            ],
          };
        }),
      ),
    );
  }

  function makeCodeDialog() {
    const label = el('input', { id: 'adm-code-label', maxlength: '30', 'data-autofocus': '' });
    const uses = el(
      'select',
      { id: 'adm-code-uses' },
      ...['3', '5', '8', '10', '20'].map((n) => el('option', { value: n }, n)),
    );
    uses.value = '8';
    const days = el(
      'select',
      { id: 'adm-code-days' },
      ...[
        ['3', '3 days'],
        ['7', '7 days'],
        ['14', '14 days'],
        ['30', '30 days'],
      ].map(([v, t]) => el('option', { value: v ?? '' }, t ?? '')),
    );
    days.value = '14';
    const cancel = el('button', { class: 'adm-btn', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', closeDialog);
    const ok = el('button', { class: 'adm-btn primary', type: 'submit' }, 'Make code');
    const form = el(
      'form',
      { class: 'adm-form' },
      el('h2', { id: 'adm-dialog-title' }, 'Make a family code'),
      field("Label (who it's for)", label),
      field('How many accounts', uses),
      field('Works for', days),
      el('p', { class: 'adm-hint' }, `${AUDIT_NOTE} The code is shown once, on the next screen.`),
      el('div', { class: 'adm-actions end' }, cancel, ok),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      ok.disabled = true;
      void act(() =>
        adminApi.createSignupCode({
          label: label.value.trim(),
          maxUses: Number(uses.value),
          days: Number(days.value),
        }),
      ).then((made) => {
        ok.disabled = false;
        if (!made) return;
        showSecrets(
          `Family code for "${made.signupCode.label}"`,
          'Shown only now. They type it on the sign-up screen.',
          [['Code', made.code]],
          `Works ${plural(made.signupCode.maxUses, 'time')}, until ${dateTime(made.signupCode.expiresAt)}.`,
          'Done',
        );
      });
    });
    openDialog(form);
  }

  // --- Find a username --------------------------------------------------------------

  function renderLookup() {
    const week = lastWeek(now());
    const patch = el('input', {
      id: 'adm-lookup-patch',
      required: '',
      minlength: '2',
      maxlength: '40',
    });
    const from = el('input', { id: 'adm-lookup-from', type: 'date', required: '' });
    const to = el('input', { id: 'adm-lookup-to', type: 'date', required: '' });
    from.value = week.from;
    to.value = week.to;
    const results = el('div', { class: 'adm-results', 'aria-live': 'polite' });
    const submit = el('button', { class: 'adm-btn primary', type: 'submit' }, 'Look up');
    const form = el(
      'form',
      { class: 'adm-panel adm-narrow' },
      el(
        'div',
        { class: 'adm-form-row' },
        field('Patch name (part is fine)', patch),
        field('Joined from', from),
        field('Joined to', to),
      ),
      el(
        'div',
        { class: 'adm-actions' },
        submit,
        el(
          'span',
          { class: 'adm-hint' },
          'Each lookup is written to the audit log. Up to 10 matches show.',
        ),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit.disabled = true;
      void act(() => adminApi.lookup({ patch: patch.value.trim(), from: from.value, to: to.value }))
        .then((found) => {
          if (!found) return;
          results.replaceChildren(
            table(
              ['Username', 'Patch', 'Since', 'Status', ''],
              found.matches.map((m) => {
                const open = el('button', { class: 'adm-btn small' }, 'Open player');
                open.addEventListener('click', () => {
                  openPlayer(m.userId);
                });
                return {
                  cells: [
                    strong(m.username),
                    m.mapName,
                    shortDate(m.since),
                    patchStatusLabel(m.status),
                    open,
                  ],
                };
              }),
            ),
            el(
              'p',
              { class: 'adm-callout' },
              "Check it's the right child (their squishies or Keeper) before you read a username out. From the player's page you can also reset their password.",
            ),
          );
        })
        .finally(() => (submit.disabled = false));
    });
    main.replaceChildren(
      head(
        'Find a username',
        'For a parent whose child forgot their username. Ask which patch they play in and roughly when they joined.',
      ),
      form,
      results,
    );
  }

  // --- Audit log ----------------------------------------------------------------------

  async function renderAudit(current: () => boolean) {
    const log: AdminAuditResponse | undefined = await call(() =>
      adminApi.audit(state.q, state.page),
    );
    if (!log || !current()) return;
    main.replaceChildren(
      head(
        'Audit log',
        "Every admin action, sign-in and host-script grant. Rows can't be edited or deleted from here.",
        search('Filter by action, name or patch', 'Filter audit log'),
      ),
      table(
        ['When', 'Who', 'Action', 'Target', ''],
        log.entries.map((entry) => ({
          cells: [
            el('span', { class: 'adm-nowrap' }, dateTime(entry.at)),
            entry.actor ?? pill('host script'),
            actionLabel(entry.action),
            auditTarget(entry),
            entry.outcome === 'done'
              ? ''
              : pill(
                  entry.outcome === 'failed' ? 'failed' : 'unfinished',
                  entry.outcome === 'failed' ? 'bad' : 'warn',
                ),
          ],
        })),
        pager(log.page, log.pageSize, log.total),
      ),
      el(
        'p',
        { class: 'adm-callout' },
        'Secrets never appear here: a reset row records who and when, never the temporary password or code.',
      ),
    );
  }

  // --- Start ------------------------------------------------------------------------

  adminApi
    .me()
    .then((me) => {
      state.me = me;
      showConsole();
    })
    .catch(() => {
      showLogin();
    });
}
