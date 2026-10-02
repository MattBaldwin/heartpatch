import {
  CreateMapRequestSchema,
  InviteCodeSchema,
  type MapDetail,
  type MapMember,
  type MemberPasswordResetResponse,
  type MyMapsResponse,
  type PublicUser,
  type PvpMode,
} from '@heartpatch/shared';
import { deviceTimeZone, el, messageOf } from '../dom.js';
import { lobbyApi } from './lobby-api.js';
import '../auth/auth.css';
import './lobby.css';

// The lobby (design doc §3): my patches, make one, join with a code, and the
// owner's admin panel. A DOM overlay over the canvas (tech spec §6), reusing
// the auth overlay's buttons and fields. Copy follows docs/STYLE_GUIDE.md;
// players call maps "patches".

const PVP_CHOICES: readonly { mode: PvpMode; label: string; hint: string }[] = [
  {
    mode: 'gentle',
    label: 'Gentle',
    hint: 'Friendly challenges. Nobody loses more than 1 tile a day.',
  },
  { mode: 'on', label: 'Challenges on', hint: 'Claim land from each other, up to 3 tiles a day.' },
  { mode: 'off', label: 'No challenges', hint: 'Everyone teams up. No challenges at all.' },
];

/** "Works for 6 more days." */
function codeLifeLeft(iso: string): string {
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days <= 1) return 'Works until tomorrow at the latest.';
  return `Works for ${String(days)} more days.`;
}

export interface Lobby {
  /** Shows the lobby for a logged-in player, or hides it (null). */
  setUser: (user: PublicUser | null) => void;
}

export function mountLobby(root: HTMLElement): Lobby {
  const panel = el('section', {
    class: 'lobby',
    'data-testid': 'lobby',
    'aria-labelledby': 'lobby-title',
  });
  panel.hidden = true;
  const card = el('div', { class: 'auth-card lobby-card' });
  panel.append(card);
  const openButton = el(
    'button',
    { type: 'button', class: 'auth-button lobby-open', 'data-testid': 'lobby-open' },
    'My patches',
  );
  openButton.hidden = true;
  root.append(panel, openButton);

  let user: PublicUser | null = null;
  /** Which screen to come back to after a refresh. */
  let refresh: () => void = () => undefined;

  const show = (...children: Node[]) => {
    card.replaceChildren(...children);
    panel.hidden = false;
    openButton.hidden = true;
    card.scrollTop = 0;
  };

  const title = (text: string) => el('h1', { class: 'auth-title', id: 'lobby-title' }, text);
  const subtitle = (text: string) => el('p', { class: 'auth-subtitle' }, text);
  const notice = (text: string, kind: 'error' | 'ok' = 'error') =>
    el(
      'p',
      {
        class: kind === 'error' ? 'auth-error' : 'lobby-notice',
        role: kind === 'error' ? 'alert' : 'status',
        'data-testid': 'lobby-notice',
      },
      text,
    );
  const button = (
    label: string,
    onClick: () => void,
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
    node.addEventListener('click', onClick);
    return node;
  };
  const backLink = (label = 'Back to my patches') => {
    const node = el('button', { type: 'button', class: 'auth-link' }, label);
    node.addEventListener('click', () => void showList());
    return node;
  };
  const loading = () => {
    show(title('One moment…'));
  };

  /** Runs an action, shows its error on `status`, and keeps double taps out. */
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

  async function showList(message?: string): Promise<void> {
    refresh = () => void showList();
    loading();
    let mine: MyMapsResponse;
    try {
      mine = await lobbyApi.myMaps();
    } catch (err) {
      show(
        title('Your patches'),
        notice(messageOf(err)),
        button('Try again', () => void showList()),
      );
      return;
    }

    const list = el('ul', { class: 'lobby-list', 'data-testid': 'lobby-maps' });
    for (const map of mine.maps) {
      const open = el(
        'button',
        { type: 'button', class: 'lobby-map' },
        el('span', { class: 'lobby-map-name' }, map.name),
        el(
          'span',
          { class: 'lobby-map-meta' },
          `${String(map.memberCount)}/${String(map.maxPlayers)} Keepers · ${
            map.role === 'owner' ? 'Yours' : `${map.owner.username}'s`
          }`,
        ),
      );
      open.addEventListener('click', () => void showMap(map.id));
      list.append(el('li', {}, open));
    }
    for (const request of mine.requests) {
      list.append(
        el(
          'li',
          { class: 'lobby-waiting', 'data-testid': 'lobby-waiting' },
          el('span', { class: 'lobby-map-name' }, request.mapName),
          el(
            'span',
            { class: 'lobby-map-meta' },
            `Waiting for ${request.owner.username} to say yes…`,
          ),
        ),
      );
    }

    const empty = mine.maps.length === 0 && mine.requests.length === 0;
    const close = el(
      'button',
      { type: 'button', class: 'auth-link', 'data-testid': 'lobby-close' },
      'Peek at the world',
    );
    close.addEventListener('click', () => {
      panel.hidden = true;
      openButton.hidden = false;
    });
    show(
      title('Your patches'),
      subtitle(
        empty
          ? 'No patches yet! Make one, or join a friend.'
          : mine.maps.length === 0
            ? 'Your request is on its way!'
            : 'Pick a patch to visit.',
      ),
      ...(message ? [notice(message, 'ok')] : []),
      ...(empty ? [] : [list]),
      el(
        'div',
        { class: 'auth-actions' },
        button('Make a patch', showCreate),
        button('Join with a code', showJoin, { soft: true }),
        ...(mine.requests.length > 0
          ? [button('Check again', () => void showList(), { soft: true, small: true })]
          : []),
      ),
      close,
    );
  }

  /** A one-field form. `submit` resolves to an error to show, or null when done. */
  function oneFieldForm(spec: {
    id: string;
    title: string;
    subtitle: string;
    label: string;
    hint: string;
    input: Record<string, string>;
    submitLabel: string;
    submit: (value: string) => Promise<string | null>;
  }): void {
    refresh = () => undefined;
    const inputId = `${spec.id}-input`;
    const input = el('input', { id: inputId, class: 'auth-input', ...spec.input });
    const error = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'lobby-error' });
    const submit = el('button', { type: 'submit', class: 'auth-button' }, spec.submitLabel);
    const form = el(
      'form',
      { class: 'auth-form', id: spec.id, novalidate: '' },
      title(spec.title),
      subtitle(spec.subtitle),
      el(
        'div',
        { class: 'auth-field' },
        el('label', { for: inputId }, spec.label),
        input,
        el('p', { class: 'auth-hint' }, spec.hint),
      ),
      error,
      submit,
      backLink(),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      error.textContent = '';
      void spec
        .submit(input.value)
        .catch((err: unknown) => messageOf(err))
        .then((problem) => {
          if (problem === null) return;
          error.textContent = problem;
          input.focus();
        })
        .finally(() => {
          submit.disabled = false;
        });
    });
    show(form);
    input.focus();
  }

  function showCreate(): void {
    oneFieldForm({
      id: 'lobby-create',
      title: 'Make a patch',
      subtitle: 'Your own corner of the world, for up to 4 Keepers.',
      label: 'Patch name',
      hint: 'Something cozy, like "Pumpkin Hollow".',
      input: { type: 'text', maxlength: '24', autocomplete: 'off' },
      submitLabel: 'Make it!',
      submit: async (name) => {
        const parsed = CreateMapRequestSchema.safeParse({ name, timeZone: deviceTimeZone() });
        if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Try another name!';
        const map = await lobbyApi.create(parsed.data);
        renderMap(map, 'Ta-da! Your patch is ready. Share the code with a friend!');
        return null;
      },
    });
  }

  function showJoin(): void {
    oneFieldForm({
      id: 'lobby-join',
      title: 'Join a patch',
      subtitle: 'Type the code a friend gave you.',
      label: 'Invite code',
      hint: 'Like ABCD-EFGH.',
      input: {
        type: 'text',
        autocapitalize: 'characters',
        autocorrect: 'off',
        spellcheck: 'false',
        autocomplete: 'off',
      },
      submitLabel: 'Ask to join',
      submit: async (code) => {
        const parsed = InviteCodeSchema.safeParse(code);
        if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Check the code!';
        const request = await lobbyApi.join(parsed.data);
        await showList(`Asked! Now ${request.owner.username} just needs to say yes.`);
        return null;
      },
    });
  }

  async function showMap(mapId: string, message?: string): Promise<void> {
    loading();
    try {
      renderMap(await lobbyApi.get(mapId), message);
    } catch (err) {
      await showList(messageOf(err));
    }
  }

  function renderMap(map: MapDetail, message?: string): void {
    refresh = () => void showMap(map.id);
    const isOwner = map.role === 'owner';
    const status = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'lobby-error' });
    const sections: Node[] = [];

    if (map.admin) {
      const { invite, requests } = map.admin;
      const inviteSection = el(
        'div',
        { class: 'lobby-section', 'data-testid': 'lobby-invite' },
        el('h2', { class: 'lobby-heading' }, 'Invite code'),
      );
      if (invite) {
        inviteSection.append(
          el('p', { class: 'auth-code', 'data-testid': 'lobby-invite-code' }, invite.code),
          el('p', { class: 'auth-hint' }, codeLifeLeft(invite.expiresAt)),
        );
      } else {
        inviteSection.append(
          el('p', { class: 'auth-hint' }, 'No code right now. Make one to invite a friend!'),
        );
      }
      const newCode = button(
        invite ? 'New code' : 'Make a code',
        () => {
          act(status, newCode, async () => {
            await lobbyApi.newInvite(map.id);
            await showMap(map.id, 'Fresh code! The old one stopped working.');
          });
        },
        { soft: true, small: true },
      );
      const row = el('div', { class: 'lobby-row' }, newCode);
      if (invite) {
        const stop = button(
          'Turn off code',
          () => {
            act(status, stop, async () => {
              await lobbyApi.revokeInvite(map.id);
              await showMap(map.id, 'Code turned off. Nobody new can ask to join.');
            });
          },
          { soft: true, small: true },
        );
        row.append(stop);
      }
      inviteSection.append(row);
      sections.push(inviteSection);

      if (requests.length > 0) {
        const list = el('ul', { class: 'lobby-list', 'data-testid': 'lobby-requests' });
        for (const request of requests) {
          const yes = button(
            'Yes!',
            () => {
              act(status, yes, async () => {
                await lobbyApi.answer(map.id, request.id, true);
                await showMap(map.id, `${request.user.username} joined your patch!`);
              });
            },
            { small: true },
          );
          const no = button(
            'No thanks',
            () => {
              act(status, no, async () => {
                await lobbyApi.answer(map.id, request.id, false);
                await showMap(map.id);
              });
            },
            { soft: true, small: true },
          );
          list.append(
            el(
              'li',
              { class: 'lobby-member' },
              el('span', { class: 'lobby-member-name' }, `${request.user.username} wants to join`),
              el('span', { class: 'lobby-row' }, yes, no),
            ),
          );
        }
        sections.push(
          el(
            'div',
            { class: 'lobby-section' },
            el('h2', { class: 'lobby-heading' }, 'Asking to join'),
            list,
          ),
        );
      }
    }

    const members = el('ul', { class: 'lobby-list', 'data-testid': 'lobby-members' });
    for (const member of map.members) members.append(memberRow(map, member));
    sections.push(
      el(
        'div',
        { class: 'lobby-section' },
        el(
          'h2',
          { class: 'lobby-heading' },
          `Keepers (${String(map.members.length)}/${String(map.maxPlayers)})`,
        ),
        members,
      ),
    );

    const pvp = el('div', {
      class: 'lobby-choices',
      role: 'radiogroup',
      'aria-label': 'Challenges',
    });
    for (const choice of PVP_CHOICES) {
      const selected = map.pvpMode === choice.mode;
      const option = el(
        'button',
        {
          type: 'button',
          class: 'lobby-choice',
          role: 'radio',
          'aria-checked': String(selected),
          ...(isOwner ? {} : { disabled: '' }),
        },
        el('span', { class: 'lobby-choice-label' }, choice.label),
        el('span', { class: 'lobby-choice-hint' }, choice.hint),
      );
      if (isOwner && !selected) {
        option.addEventListener('click', () => {
          act(status, option, async () => {
            await lobbyApi.setPvpMode(map.id, choice.mode);
            await showMap(map.id, `Challenges: ${choice.label}.`);
          });
        });
      }
      pvp.append(option);
    }
    sections.push(
      el(
        'div',
        { class: 'lobby-section' },
        el('h2', { class: 'lobby-heading' }, 'Challenges'),
        ...(isOwner ? [] : [el('p', { class: 'auth-hint' }, 'The patch owner picks this.')]),
        pvp,
      ),
    );

    if (!isOwner) {
      sections.push(
        el(
          'div',
          { class: 'lobby-section' },
          button(
            'Leave patch',
            () => {
              confirm({
                title: `Leave ${map.name}?`,
                body: 'Your land here goes back to the wild. You can ask to join again later.',
                yes: 'Leave',
                onYes: async () => {
                  await lobbyApi.leave(map.id);
                  await showList(`You left ${map.name}.`);
                },
                onNo: () => void showMap(map.id),
              });
            },
            { soft: true, small: true },
          ),
        ),
      );
    }

    show(
      title(map.name),
      subtitle(isOwner ? 'You own this patch.' : 'A patch you belong to.'),
      ...(message ? [notice(message, 'ok')] : []),
      status,
      ...sections,
      backLink(),
    );
  }

  function memberRow(map: MapDetail, member: MapMember): HTMLElement {
    const isMe = member.user.id === user?.id;
    const name = `${member.user.username}${isMe ? ' (you)' : ''}`;
    const row = el(
      'li',
      { class: 'lobby-member' },
      el(
        'span',
        { class: 'lobby-member-name' },
        name,
        ...(member.role === 'owner' ? [el('span', { class: 'lobby-badge' }, 'Owner')] : []),
      ),
    );
    if (map.role === 'owner' && !isMe) {
      const who = member.user.username;
      const reset = button(
        'Reset password',
        () => {
          confirm({
            title: `Reset ${who}'s password?`,
            body: `${who} gets logged out everywhere. You'll see a new password and recovery code to give them.`,
            yes: 'Reset',
            onYes: async () => {
              showReset(map, await lobbyApi.resetPassword(map.id, member.user.id));
            },
            onNo: () => void showMap(map.id),
          });
        },
        { soft: true, small: true },
      );
      const remove = button(
        'Remove',
        () => {
          confirm({
            title: `Remove ${who}?`,
            body: `${who} leaves ${map.name}, and their land goes back to the wild.`,
            yes: 'Remove',
            onYes: async () => {
              await lobbyApi.remove(map.id, member.user.id);
              await showMap(map.id, `${who} left the patch.`);
            },
            onNo: () => void showMap(map.id),
          });
        },
        { soft: true, small: true },
      );
      row.append(el('span', { class: 'lobby-row' }, reset, remove));
    }
    return row;
  }

  /** Style guide §3.6: confirm anything you can't undo, with a friendly summary. */
  function confirm(spec: {
    title: string;
    body: string;
    yes: string;
    onYes: () => Promise<void>;
    onNo: () => void;
  }): void {
    refresh = () => undefined;
    const status = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'lobby-error' });
    const yes = button(spec.yes, () => {
      act(status, yes, spec.onYes);
    });
    show(
      title(spec.title),
      subtitle(spec.body),
      status,
      el('div', { class: 'auth-actions' }, yes, button('Never mind', spec.onNo, { soft: true })),
    );
  }

  /** Shown once; the server keeps only hashes. */
  function showReset(map: MapDetail, result: MemberPasswordResetResponse): void {
    refresh = () => undefined;
    show(
      title('New password ready'),
      subtitle(`Give these to ${result.user.username}. You'll only see them once!`),
      el('p', { class: 'auth-hint' }, 'Password'),
      el(
        'p',
        { class: 'auth-code', 'data-testid': 'lobby-temp-password' },
        result.temporaryPassword,
      ),
      el('p', { class: 'auth-hint' }, 'Recovery code'),
      el('p', { class: 'auth-code', 'data-testid': 'lobby-recovery-code' }, result.recoveryCode),
      el(
        'p',
        { class: 'auth-hint' },
        'They can log in with the password, then pick a new one with "Forgot your password?" and the recovery code.',
      ),
      el(
        'div',
        { class: 'auth-actions' },
        button('Done', () => void showMap(map.id)),
      ),
    );
  }

  openButton.addEventListener('click', () => void showList());
  // iOS pauses background tabs; catch up when the player comes back (tech spec §5).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user && !panel.hidden) refresh();
  });

  return {
    setUser: (next) => {
      user = next;
      if (next) {
        void showList();
      } else {
        panel.hidden = true;
        openButton.hidden = true;
        card.replaceChildren();
      }
    },
  };
}
