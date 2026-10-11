import { friendlyApi } from '../../friendly/friendly-api.js';
import { FRIENDLY_TEXT } from '../../friendly/friendly-model.js';
import {
  CreateMapRequestSchema,
  MAP_MAX_PLAYERS,
  CreateSignupCodeRequestSchema,
  InviteCodeSchema,
  SIGNUP_CODE_LABEL_MAX,
  type CreateSignupCodeResponse,
  type MapDetail,
  type MapMember,
  type MemberPasswordResetResponse,
  type MyMapsResponse,
  type MySignupCodesResponse,
  type PublicUser,
  type PvpMode,
} from '@heartpatch/shared';
import { slotIcon } from '../../map/map-legend.js';
import { updateHold } from '../../pwa/update-hold.js';
import { deviceTimeZone, el, messageOf } from '../dom.js';
import {
  familyCodeBadge,
  familyCodeMeta,
  familyCodeUsedBy,
  liveFamilyCodes,
} from './family-codes.js';
import { forgetPatch, patchToResume, rememberPatch } from './last-patch.js';
import { closeListTo, LOBBY_PEEK_TEXT, lobbyChrome, type LobbyMode } from './lobby-chrome.js';
import { lobbyApi } from './lobby-api.js';
import { joinedSince, listKey, WAITING_POLL_MS } from './lobby-poll.js';
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

/** A press that moves or scrolls the list further than this is a swipe, not a tap (px). */
const SWIPE_SLOP_PX = 10; // TUNE: about iOS's own tap slop

/** "Works for 6 more days." */
function codeLifeLeft(iso: string): string {
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days <= 1) return 'Works until tomorrow at the latest.';
  return `Works for ${String(days)} more days.`;
}

/** "14 days" (rounded up). */
function codeDays(iso: string): string {
  const days = Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
  return days === 1 ? '1 day' : `${String(days)} days`;
}

export interface Lobby {
  /** Shows the lobby for a logged-in player, or hides it (null). */
  setUser: (user: PublicUser | null) => void;
  /** Opens the lobby's patch list with a message (e.g. after leaving a map). */
  showMessage: (message: string) => void;
  /** Opens "Make a patch" or "Join a patch" (the tutorial's graduation choices). */
  showCreate: () => void;
  showJoin: () => void;
  /** Redraws the patch list if it's on screen (e.g. the tutorial's button changed). */
  refreshList: () => void;
  /** Shows the patch list (e.g. back from the Tutorial Glade). */
  show: () => void;
  /** Steps aside for a map, leaving the "My patches" button (as "Visit patch" does). */
  hide: () => void;
  /**
   * Steps all the way aside, button included, for a screen that owns the
   * whole stage (a battle). `hide` brings the button back.
   */
  stepOut: () => void;
  /** Opens the Settings screen (the Keeper menu over the map). */
  showSettings: () => void;
  /** True while the lobby's panel is up (over the map, or on its own). */
  readonly isOpen: boolean;
  /**
   * True while "Make a patch" or "Join a patch" is on screen: a celebration
   * (the First Patch milestone) waits until the player is done typing.
   */
  readonly formOpen: boolean;
}

export interface LobbyOptions {
  /** Shows a patch's map; rejects with a player-safe message if it can't. */
  onOpen?: (mapId: string) => Promise<void>;
  /** Extra buttons under the patch list (the tutorial's "Meet Sprout", #47). */
  listActions?: () => Node[];
  /** Shown under the patch list's title (the Patch Coin counter, #45). */
  listHeader?: () => Node[];
  /** Rows on the Settings screen (the tutorial's replay, #47). */
  settings?: () => Node[];
  /**
   * True while a patch is on screen behind the lobby (#212): "Look around the
   * world" then goes back to it, and the "Back to my patches" pill stays
   * away. main.ts knows (the map's HUD); defaults to none.
   */
  patchOpen?: () => boolean;
  /** Where the "My patches" button goes over a map (the trays' corner); defaults to `root`. */
  buttonRoot?: HTMLElement;
  /**
   * Whether a log-in or reload may land back on the last patch visited
   * (#160). False while something else opens by itself instead (a tutorial
   * run going). Defaults to yes.
   */
  canResume?: () => Promise<boolean>;
}

export function mountLobby(root: HTMLElement, options: LobbyOptions = {}): Lobby {
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
  // While peeking at the world with no patch open, the way back is big and
  // plain (#212); the corner button still works too.
  const backPill = el(
    'button',
    { type: 'button', class: 'auth-button lobby-back', 'data-testid': 'lobby-back' },
    LOBBY_PEEK_TEXT.back,
  );
  backPill.hidden = true;
  root.append(panel, backPill);
  (options.buttonRoot ?? root).append(openButton);

  /** Shows the panel, corner button and back pill for `mode` (lobby-chrome.ts). */
  const setMode = (mode: LobbyMode) => {
    const chrome = lobbyChrome(mode);
    panel.hidden = !chrome.panel;
    openButton.hidden = !chrome.openButton;
    backPill.hidden = !chrome.backPill;
  };

  let user: PublicUser | null = null;
  /** Which screen to come back to after a refresh. */
  let refresh: () => void = () => undefined;
  /** True while the patch list is the screen showing. */
  let onList = false;
  /** True while a one-field form (make, join) is the screen showing. */
  let onForm = false;
  /** Bumped by every screen change, so a slow list fetch can't cover a newer screen. */
  let shown = 0;
  /** Set while a one-time password and recovery code are on screen (#47). */
  let releaseUpdates: (() => void) | null = null;
  /** True from a log-in (or reload) until the first patch list: land on the last patch (#160). */
  let resumePending = false;
  /** Asks the server again while a join request waits (#145). */
  let pollTimer: number | undefined;

  const stopPolling = () => {
    if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const show = (...children: Node[]) => {
    stopPolling();
    releaseUpdates?.();
    releaseUpdates = null;
    onList = false;
    onForm = false;
    shown += 1;
    card.replaceChildren(...children);
    setMode('list');
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
    const at = shown;
    let mine: MyMapsResponse;
    try {
      mine = await lobbyApi.myMaps();
    } catch (err) {
      if (at !== shown) return;
      show(
        title('Your patches'),
        notice(messageOf(err)),
        button('Try again', () => void showList()),
      );
      return;
    }

    if (at !== shown) return;
    if (resumePending) {
      resumePending = false;
      if (await resume(mine, at)) return;
      if (at !== shown) return;
    }
    renderList(mine, message);
  }

  /**
   * Lands back on the patch the player was on (#160), as "Visit patch"
   * would. True if it opened; false leaves the patch list to show.
   */
  async function resume(mine: MyMapsResponse, at: number): Promise<boolean> {
    const who = user;
    const { onOpen } = options;
    if (!who || !onOpen) return false;
    const mapId = patchToResume(who.id, mine.maps);
    if (mapId === null) return false;
    const allowed = await (options.canResume?.() ?? Promise.resolve(true)).catch(() => false);
    if (!allowed || at !== shown || user !== who) return false;
    try {
      await onOpen(mapId);
    } catch {
      // Gone wobbly: start from the patch list (it says what happened, if anything).
      forgetPatch(who.id);
      return false;
    }
    setMode('map');
    return true;
  }

  /** While a request waits, looks again every few seconds and redraws on any change (#145). */
  function pollWhileWaiting(mine: MyMapsResponse, at: number): void {
    if (mine.requests.length === 0) return;
    pollTimer = window.setTimeout(() => {
      pollTimer = undefined;
      if (at !== shown || panel.hidden || !onList) return;
      if (document.visibilityState !== 'visible') {
        // iOS paused us; `visibilitychange` refreshes on the way back.
        return;
      }
      lobbyApi
        .myMaps()
        .then((next) => {
          if (at !== shown || panel.hidden) return;
          if (listKey(next) === listKey(mine)) {
            pollWhileWaiting(mine, at);
            return;
          }
          const joined = joinedSince(mine, next)[0];
          renderList(next, joined === undefined ? undefined : `Yay! You're in ${joined}!`);
        })
        .catch(() => {
          // Offline for a moment: try again on the next beat.
          if (at === shown) pollWhileWaiting(mine, at);
        });
    }, WAITING_POLL_MS);
  }

  function renderList(mine: MyMapsResponse, message?: string): void {
    const list = el('ul', { class: 'lobby-list', 'data-testid': 'lobby-maps' });
    for (const map of mine.maps) {
      const open = el(
        'button',
        { type: 'button', class: 'lobby-map' },
        el(
          'span',
          { class: 'lobby-map-name' },
          map.name,
          // Someone is asking to join (#144): say so right on the row.
          ...(map.pendingRequests > 0
            ? [
                el(
                  'span',
                  { class: 'lobby-badge lobby-badge-alert', 'data-testid': 'lobby-map-asking' },
                  map.pendingRequests === 1
                    ? '1 wants to join!'
                    : `${String(map.pendingRequests)} want to join!`,
                ),
              ]
            : []),
        ),
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
    const settingsLink = el(
      'button',
      { type: 'button', class: 'auth-link', 'data-testid': 'lobby-settings' },
      'Settings',
    );
    settingsLink.addEventListener('click', showSettings);
    const close = el(
      'button',
      { type: 'button', class: 'auth-link', 'data-testid': 'lobby-close' },
      LOBBY_PEEK_TEXT.lookAround,
    );
    close.addEventListener('click', () => {
      setMode(closeListTo(options.patchOpen?.() ?? false));
    });
    show(
      title('Your patches'),
      ...(options.listHeader?.() ?? []),
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
      ...(options.listActions?.() ?? []),
      ...(options.settings ? [settingsLink] : []),
      close,
    );
    onList = true;
    pollWhileWaiting(mine, shown);
  }

  function showSettings(): void {
    refresh = () => undefined;
    show(title('Settings'), ...(options.settings?.() ?? []), backLink());
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
    onForm = true;
    input.focus();
  }

  function showCreate(): void {
    oneFieldForm({
      id: 'lobby-create',
      title: 'Make a patch',
      subtitle: `Your own corner of the world, for up to ${String(MAP_MAX_PLAYERS)} Keepers.`,
      label: 'Patch name',
      hint: 'Something cozy, like "Pumpkin Meadow".',
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
    /** Fetches that fill this screen in, started once it's the one showing. */
    let afterShow: (() => void) | undefined;

    const { onOpen } = options;
    if (onOpen) {
      const visit = button('Visit patch', () => {
        act(status, visit, async () => {
          await onOpen(map.id);
          if (user) rememberPatch(user.id, map.id);
          setMode('map');
        });
      });
      sections.push(el('div', { class: 'auth-actions' }, visit));
    }

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
          el(
            'p',
            { class: 'auth-hint' },
            // It signs a new family up too (#195).
            `${codeLifeLeft(invite.expiresAt)} New families can sign up with it too!`,
          ),
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
              await showMap(map.id, 'Code turned off. Nobody new can use it.');
            });
          },
          { soft: true, small: true },
        );
        row.append(stop);
      }
      inviteSection.append(row);
      const familyCodes = familyCodesSection(map, status);
      sections.push(inviteSection, familyCodes.section);
      afterShow = familyCodes.load;

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
    // Home order, as on the map (#318), then each open seat, so a 6-seat patch reads at a glance.
    const seated = [...map.members].sort(
      (a, b) => (a.homeSlot ?? Infinity) - (b.homeSlot ?? Infinity),
    );
    for (const member of seated) members.append(memberRow(map, member));
    for (let i = map.members.length; i < map.maxPlayers; i++) {
      members.append(
        el(
          'li',
          { class: 'lobby-member lobby-member-open', 'data-testid': 'lobby-open-seat' },
          el('span', { class: 'lobby-member-name' }, 'A home is waiting for a friend'),
        ),
      );
    }
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
        el(
          'span',
          { class: 'lobby-choice-label' },
          choice.label,
          // The picked one says so in words too, not only by its border (#146).
          ...(selected
            ? [el('span', { class: 'lobby-choice-picked', 'aria-hidden': 'true' }, '✓ Picked')]
            : []),
        ),
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

    // Friendly battles (#29): the owner's on/off switch, like Challenges.
    const friendlyOn = map.friendlyChallenges !== false;
    const friendly = el('div', {
      class: 'lobby-choices',
      role: 'radiogroup',
      'aria-label': FRIENDLY_TEXT.ownerSwitch,
    });
    for (const choice of [
      { on: true, label: FRIENDLY_TEXT.ownerOn, hint: FRIENDLY_TEXT.ownerOnHint },
      { on: false, label: FRIENDLY_TEXT.ownerOff, hint: FRIENDLY_TEXT.ownerOffHint },
    ]) {
      const selected = friendlyOn === choice.on;
      const option = el(
        'button',
        {
          type: 'button',
          class: 'lobby-choice',
          role: 'radio',
          'aria-checked': String(selected),
          'data-testid': `lobby-friendly-${choice.on ? 'on' : 'off'}`,
          ...(isOwner ? {} : { disabled: '' }),
        },
        el(
          'span',
          { class: 'lobby-choice-label' },
          choice.label,
          ...(selected
            ? [el('span', { class: 'lobby-choice-picked', 'aria-hidden': 'true' }, '✓ Picked')]
            : []),
        ),
        el('span', { class: 'lobby-choice-hint' }, choice.hint),
      );
      if (isOwner && !selected) {
        option.addEventListener('click', () => {
          act(status, option, async () => {
            await friendlyApi.setFriendly(map.id, choice.on);
            await showMap(map.id, `${FRIENDLY_TEXT.ownerSwitch}: ${choice.label}.`);
          });
        });
      }
      friendly.append(option);
    }
    sections.push(
      el(
        'div',
        { class: 'lobby-section' },
        el('h2', { class: 'lobby-heading' }, FRIENDLY_TEXT.ownerSwitch),
        ...(isOwner ? [] : [el('p', { class: 'auth-hint' }, 'The patch owner picks this.')]),
        friendly,
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
                  if (user) forgetPatch(user.id);
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
    afterShow?.();
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
        // Their colour and icon on the map (#318).
        ...(member.homeSlot !== null ? [slotIcon(member.homeSlot)] : []),
        name,
        ...(member.role === 'owner' ? [el('span', { class: 'lobby-badge' }, 'Owner')] : []),
      ),
      // Their milestone title (#44), the profile card's line.
      ...(member.title
        ? [el('span', { class: 'lobby-member-title', 'data-testid': 'member-title' }, member.title)]
        : []),
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

  /**
   * The owner's family codes (#195): the same list on every patch they own,
   * since codes belong to the player. Filled in when the list arrives.
   */
  function familyCodesSection(
    map: MapDetail,
    status: HTMLElement,
  ): { section: HTMLElement; load: () => void } {
    const section = el(
      'div',
      { class: 'lobby-section', 'data-testid': 'lobby-family-codes' },
      el('h2', { class: 'lobby-heading' }, 'Family codes'),
    );
    // Call once the screen is showing: a newer screen drops a late answer.
    const load = () => {
      const at = shown;
      lobbyApi
        .signupCodes()
        .then((mine) => {
          if (at !== shown) return;
          section.append(...familyCodesBody(map, status, mine));
        })
        .catch((err: unknown) => {
          if (at !== shown) return;
          section.append(el('p', { class: 'auth-hint' }, messageOf(err)));
        });
    };
    return { section, load };
  }

  function familyCodesBody(
    map: MapDetail,
    status: HTMLElement,
    mine: MySignupCodesResponse,
  ): Node[] {
    const nodes: Node[] = [
      el(
        'p',
        { class: 'auth-hint' },
        `A family code lets a new family make accounts. You can have ${String(mine.liveMax)} at a time.`,
      ),
    ];
    if (mine.codes.length > 0) {
      const list = el('ul', { class: 'lobby-list', 'data-testid': 'lobby-family-code-list' });
      const now = Date.now();
      for (const code of mine.codes) {
        const badge = familyCodeBadge(code.status);
        let corner: Node;
        if (badge) {
          corner = el('span', { class: 'lobby-badge lobby-badge-ended' }, badge);
        } else {
          const off = button(
            'Turn off',
            () => {
              act(status, off, async () => {
                await lobbyApi.revokeSignupCode(code.id);
                await showMap(map.id, 'Code turned off. Accounts made with it stay safe.');
              });
            },
            { soft: true, small: true },
          );
          corner = off;
        }
        const usedBy = familyCodeUsedBy(code);
        list.append(
          el(
            'li',
            { class: `lobby-code${badge ? ' lobby-code-ended' : ''}` },
            el(
              'span',
              { class: 'lobby-code-top' },
              el('span', { class: 'lobby-map-name' }, code.label),
              corner,
            ),
            el('span', { class: 'lobby-map-meta' }, familyCodeMeta(code, now)),
            ...(usedBy ? [el('span', { class: 'lobby-map-meta' }, usedBy)] : []),
          ),
        );
      }
      nodes.push(list);
    }

    if (liveFamilyCodes(mine.codes) >= mine.liveMax) {
      nodes.push(
        el(
          'p',
          { class: 'auth-hint' },
          `You have ${String(mine.liveMax)} codes. Turn one off to make another!`,
        ),
      );
      return nodes;
    }
    const inputId = 'lobby-family-code-label';
    const input = el('input', {
      id: inputId,
      class: 'auth-input',
      type: 'text',
      maxlength: String(SIGNUP_CODE_LABEL_MAX),
      autocomplete: 'off',
      placeholder: 'Like “Lee family”',
    });
    const make = button(
      'Make a family code',
      () => {
        act(status, make, async () => {
          const parsed = CreateSignupCodeRequestSchema.safeParse({ label: input.value });
          if (!parsed.success) {
            status.textContent = parsed.error.issues[0]?.message ?? 'Try another name!';
            input.focus();
            return;
          }
          showFamilyCode(map, await lobbyApi.newSignupCode(parsed.data.label));
        });
      },
      { small: true, testId: 'lobby-make-family-code' },
    );
    nodes.push(
      el('div', { class: 'auth-field' }, el('label', { for: inputId }, "Who's it for?"), input),
      el('div', { class: 'lobby-row' }, make),
    );
    return nodes;
  }

  /** Shown once; the server keeps only a hash. */
  function showFamilyCode(map: MapDetail, result: CreateSignupCodeResponse): void {
    refresh = () => undefined;
    const { signupCode } = result;
    const copy = button(
      'Copy',
      () => {
        navigator.clipboard
          .writeText(result.code)
          .then(() => {
            copy.textContent = 'Copied!';
          })
          .catch(() => {
            copy.textContent = 'Write it down instead';
          });
      },
      { soft: true },
    );
    show(
      title("Here's the code!"),
      subtitle(`For ${signupCode.label}`),
      el('p', { class: 'auth-code', 'data-testid': 'lobby-family-code' }, result.code),
      el(
        'p',
        { class: 'auth-hint' },
        "Write it down or copy it now. You'll only see it this once!",
      ),
      el(
        'p',
        { class: 'auth-hint' },
        `It works for ${String(signupCode.maxUses)} people and ${codeDays(signupCode.expiresAt)}. They type it on the sign-up screen.`,
      ),
      el(
        'div',
        { class: 'auth-actions' },
        button('All done!', () => void showMap(map.id)),
        ...('clipboard' in navigator ? [copy] : []),
      ),
    );
    // Shown once: an automatic update must not reload it away (#47).
    releaseUpdates = updateHold.hold();
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
    // Shown once: an automatic update must not reload it away (#47).
    releaseUpdates = updateHold.hold();
  }

  // A swipe is never a tap (#146): if the finger moved or the list scrolled
  // between press and release, the click that follows is dropped before any
  // button sees it. Browsers usually cancel it themselves; this makes sure a
  // scroll that starts on "Remove" can't land on it.
  let press: { x: number; y: number; scroll: number } | null = null;
  panel.addEventListener(
    'pointerdown',
    (e) => {
      press = { x: e.clientX, y: e.clientY, scroll: panel.scrollTop };
    },
    { capture: true, passive: true },
  );
  panel.addEventListener(
    'click',
    (e) => {
      const p = press;
      press = null;
      if (!p || e.detail === 0) return; // keyboard or assistive tech: always a tap
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SWIPE_SLOP_PX;
      if (moved || Math.abs(panel.scrollTop - p.scroll) > SWIPE_SLOP_PX) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );

  openButton.addEventListener('click', () => void showList());
  backPill.addEventListener('click', () => void showList());
  // iOS pauses background tabs; catch up when the player comes back (tech spec §5).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user && !panel.hidden) refresh();
  });

  return {
    setUser: (next) => {
      user = next;
      resumePending = next !== null;
      if (next) {
        void showList();
      } else {
        show(); // clears the card (and any hold on updates)
        setMode('away');
      }
    },
    showMessage: (message) => {
      if (user) void showList(message);
    },
    showCreate: () => {
      if (user) showCreate();
    },
    showJoin: () => {
      if (user) showJoin();
    },
    refreshList: () => {
      if (user && onList && !panel.hidden) void showList();
    },
    show: () => {
      if (user) void showList();
    },
    hide: () => {
      if (!user) return;
      releaseUpdates?.();
      releaseUpdates = null;
      setMode('map');
    },
    stepOut: () => {
      releaseUpdates?.();
      releaseUpdates = null;
      setMode('away');
    },
    showSettings,
    get isOpen() {
      return !panel.hidden;
    },
    get formOpen() {
      return !panel.hidden && onForm;
    },
  };
}
