import type {
  ChallengesResponse,
  ChallengeView,
  OnlineMember,
  PlayerBattle,
  PublicUser,
  WsEventMessage,
} from '@heartpatch/shared';
import { battleApi } from '../battle/battle-api.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { friendlyApi, type FriendlyApi } from './friendly-api.js';
import { challengeEventFor, FRIENDLY_TEXT, gapLine, waitLeft } from './friendly-model.js';
import './friendly.css';

// Friendly battles (#29, the owner-approved mockup's frames 1–5): a Friends
// button over a multiplayer patch opens "Who's here now"; "Battle me?" shows
// the card, then the wait. The friend gets the ask over any screen and
// answers "Battle!" or "Not now!". A yes opens the live battle for both.
// DOM only; the server decides everything (rule 1), and only ids travel.

export interface FriendlyScreenOptions {
  root: HTMLElement;
  /** Where the Friends button goes (a tray over the map); defaults to `root`. */
  entryRoot?: HTMLElement;
  api?: FriendlyApi;
  battles?: Pick<typeof battleApi, 'get'>;
  /** The patch's members (names for the sheet, and who's away). */
  members: (mapId: string) => readonly { userId: string; username: string }[];
  /** Opens a battle that just started (the battle screen). */
  openBattle: (battle: PlayerBattle) => void;
  /** Opens the team picker for the map ("Change" on the card). */
  openTeam?: (mapId: string) => void;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface FriendlyDebug {
  readonly mapId: string;
  readonly mode: Mode['type'];
  readonly online: readonly string[];
  readonly incoming: readonly string[];
  readonly outgoing: string | null;
  readonly note: string;
}

export interface FriendlyScreen {
  /** The multiplayer patch on screen (null: none, or the Glade). */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** Every live event on the open map (map-screen `onLiveEvent`). */
  liveEvent: (event: WsEventMessage) => void;
  readonly debug: FriendlyDebug | null;
}

type Mode =
  | { type: 'closed' }
  | { type: 'list' }
  | { type: 'card'; who: OnlineMember }
  | { type: 'waiting'; challenge: ChallengeView }
  | { type: 'declined'; name: string };

/** How often "Who's here now" looks again while it's open. */
const LIST_REFRESH_MS = 10_000; // TUNE: presence changes as phones sleep and wake

export function createFriendlyScreen(options: FriendlyScreenOptions): FriendlyScreen {
  const api = options.api ?? friendlyApi;
  const battles = options.battles ?? battleApi;
  const now = options.now ?? (() => Date.now());
  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let view: ChallengesResponse | null = null;
  let mode: Mode = { type: 'closed' };
  let note = '';
  let working = false;
  /** Bumped on every map and user change, so a late reply is dropped. */
  let ticket = 0;
  let listTimer = 0;
  let askTimer = 0;
  let barTimer = 0;
  /** The ask on screen for me to answer (the first waiting one). */
  let incoming: ChallengeView | null = null;

  const nameOf = (userId: string): string =>
    (mapId ? options.members(mapId).find((m) => m.userId === userId)?.username : undefined) ??
    'A friend';

  // ── Entry button ──────────────────────────────────────────────────────
  const openButton = el(
    'button',
    {
      type: 'button',
      class: 'auth-button auth-button-soft auth-button-small friendly-open',
      'data-testid': 'friendly-open',
    },
    FRIENDLY_TEXT.open,
  );
  openButton.hidden = true;
  openButton.addEventListener('click', () => {
    mode = { type: 'list' };
    note = '';
    render();
    void load();
  });

  // ── The sheet (list, card, waiting, declined) ────────────────────────
  const sheet = el('section', {
    class: 'friendly-sheet',
    role: 'dialog',
    'aria-labelledby': 'friendly-title',
    'data-testid': 'friendly',
  });
  sheet.hidden = true;

  // ── The ask a friend sent me (over any screen) ───────────────────────
  const askCard = el('section', {
    class: 'friendly-ask',
    role: 'alertdialog',
    'aria-labelledby': 'friendly-ask-title',
    'data-testid': 'friendly-ask',
  });
  askCard.hidden = true;
  const toast = el('p', {
    class: 'friendly-toast',
    role: 'status',
    'data-testid': 'friendly-toast',
  });
  toast.hidden = true;
  let toastTimer = 0;

  (options.entryRoot ?? options.root).append(openButton);
  options.root.append(sheet, askCard, toast);

  const button = (
    text: string,
    onClick: () => void,
    extra: { soft?: boolean; testId?: string; disabled?: boolean } = {},
  ): HTMLButtonElement => {
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button friendly-button${extra.soft ? ' auth-button-soft' : ''}`,
        ...(extra.testId ? { 'data-testid': extra.testId } : {}),
        ...(extra.disabled ? { disabled: '' } : {}),
      },
      text,
    );
    b.addEventListener('click', onClick);
    return b;
  };

  const avatar = (name: string): HTMLElement =>
    el('span', { class: 'friendly-avatar', 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase());

  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 4000);
  }

  function closeSheet(): void {
    mode = { type: 'closed' };
    note = '';
    render();
  }

  function renderList(): HTMLElement[] {
    const nodes: HTMLElement[] = [
      el('h2', { class: 'friendly-title', id: 'friendly-title' }, FRIENDLY_TEXT.title),
    ];
    if (view && !view.friendlyChallenges) {
      nodes.push(el('p', { class: 'friendly-intro' }, FRIENDLY_TEXT.switchedOff));
      return nodes;
    }
    nodes.push(el('p', { class: 'friendly-intro' }, FRIENDLY_TEXT.intro));
    const list = el('ul', { class: 'friendly-list', 'data-testid': 'friendly-list' });
    const online = view?.online ?? [];
    for (const who of online) {
      list.append(
        el(
          'li',
          { class: 'friendly-row', 'data-user': who.userId },
          avatar(who.username),
          el(
            'span',
            { class: 'friendly-row-text' },
            el('span', { class: 'friendly-name' }, who.username),
            el(
              'span',
              { class: 'friendly-status' },
              who.inBattle ? FRIENDLY_TEXT.inBattle : FRIENDLY_TEXT.here(who.teamLevel),
            ),
          ),
          who.inBattle
            ? button(FRIENDLY_TEXT.busy, () => undefined, { soft: true, disabled: true })
            : button(
                FRIENDLY_TEXT.battleMe,
                () => {
                  mode = { type: 'card', who };
                  note = '';
                  render();
                },
                { testId: 'friendly-battle-me' },
              ),
        ),
      );
    }
    const here = new Set(online.map((o) => o.userId));
    for (const member of mapId ? options.members(mapId) : []) {
      if (member.userId === user?.id || here.has(member.userId)) continue;
      list.append(
        el(
          'li',
          { class: 'friendly-row friendly-row-away' },
          avatar(member.username),
          el(
            'span',
            { class: 'friendly-row-text' },
            el('span', { class: 'friendly-name' }, member.username),
            el('span', { class: 'friendly-status' }, FRIENDLY_TEXT.away),
          ),
        ),
      );
    }
    nodes.push(list);
    nodes.push(
      el(
        'p',
        { class: 'friendly-hint' },
        online.length === 0 ? FRIENDLY_TEXT.nobodyHere : FRIENDLY_TEXT.onlyHere,
      ),
    );
    return nodes;
  }

  function renderCard(who: OnlineMember): HTMLElement[] {
    const mine = view?.myTeamLevel ?? 0;
    const gap = gapLine(mine, who.teamLevel, who.username);
    const id = mapId;
    return [
      el(
        'div',
        { class: 'friendly-pair', 'aria-hidden': 'true' },
        avatar(user?.username ?? FRIENDLY_TEXT.you),
        el('span', { class: 'friendly-and' }, FRIENDLY_TEXT.and),
        avatar(who.username),
      ),
      el(
        'h2',
        { class: 'friendly-title friendly-center', id: 'friendly-title' },
        FRIENDLY_TEXT.cardTitle(who.username),
      ),
      ...(gap ? [el('p', { class: 'friendly-gap', 'data-testid': 'friendly-gap' }, gap)] : []),
      el(
        'div',
        { class: 'friendly-team' },
        el('span', { class: 'friendly-name' }, `${FRIENDLY_TEXT.yourTeam} · level ${String(mine)}`),
        ...(options.openTeam && id
          ? [
              button(
                FRIENDLY_TEXT.changeTeam,
                () => {
                  options.openTeam?.(id);
                },
                { soft: true },
              ),
            ]
          : []),
      ),
      el('p', { class: 'friendly-hint friendly-center' }, FRIENDLY_TEXT.nothingAtStake),
      button(
        FRIENDLY_TEXT.battleMe,
        () => {
          void ask(who);
        },
        { testId: 'friendly-ask-send', disabled: working },
      ),
      button(
        FRIENDLY_TEXT.maybeLater,
        () => {
          mode = { type: 'list' };
          note = '';
          render();
        },
        { soft: true },
      ),
    ];
  }

  function renderWaiting(challenge: ChallengeView): HTMLElement[] {
    const name = nameOf(challenge.toUserId);
    return [
      avatar(name),
      el(
        'h2',
        { class: 'friendly-title friendly-center', id: 'friendly-title' },
        FRIENDLY_TEXT.asking(name),
      ),
      el('div', { class: 'friendly-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
      el('p', { class: 'friendly-intro friendly-center' }, FRIENDLY_TEXT.askingSub(name)),
      el('p', { class: 'friendly-hint friendly-center' }, FRIENDLY_TEXT.waitUpTo),
      button(
        FRIENDLY_TEXT.neverMind,
        () => {
          void cancel(challenge);
        },
        { soft: true, testId: 'friendly-never-mind', disabled: working },
      ),
    ];
  }

  function renderDeclined(name: string): HTMLElement[] {
    return [
      el(
        'h2',
        { class: 'friendly-title friendly-center', id: 'friendly-title' },
        FRIENDLY_TEXT.cantNow(name),
      ),
      el('p', { class: 'friendly-intro friendly-center' }, FRIENDLY_TEXT.cantNowSub),
      el('p', { class: 'friendly-hint friendly-center' }, FRIENDLY_TEXT.askAgainIn(name)),
      button(FRIENDLY_TEXT.okay, closeSheet, { testId: 'friendly-okay' }),
    ];
  }

  function render(): void {
    const multiplayer = mapId !== null && user !== null;
    openButton.hidden = !multiplayer || mode.type !== 'closed';
    sheet.hidden = !multiplayer || mode.type === 'closed';
    window.clearInterval(listTimer);
    listTimer = 0;
    if (!sheet.hidden) {
      const body =
        mode.type === 'list'
          ? renderList()
          : mode.type === 'card'
            ? renderCard(mode.who)
            : mode.type === 'waiting'
              ? renderWaiting(mode.challenge)
              : mode.type === 'declined'
                ? renderDeclined(mode.name)
                : [];
      const noteLine = el(
        'p',
        { class: 'friendly-note', role: 'status', 'data-testid': 'friendly-note' },
        note,
      );
      noteLine.hidden = note === '';
      const close = el(
        'button',
        {
          type: 'button',
          class: 'tile-panel-close friendly-close',
          'aria-label': FRIENDLY_TEXT.close,
        },
        '×',
      );
      close.addEventListener('click', closeSheet);
      sheet.replaceChildren(close, ...body, noteLine);
      if (mode.type === 'list') {
        listTimer = window.setInterval(() => {
          void load();
        }, LIST_REFRESH_MS);
      }
    }
    renderAsk();
  }

  function renderAsk(): void {
    window.clearInterval(barTimer);
    barTimer = 0;
    const ask = incoming;
    askCard.hidden = ask === null || mapId === null;
    if (!ask) return;
    const name = nameOf(ask.fromUserId);
    const fill = el('span', { class: 'friendly-bar-fill' });
    const tick = () => {
      fill.style.width = `${String(Math.round(waitLeft(ask, now()) * 100))}%`;
    };
    tick();
    barTimer = window.setInterval(tick, 500);
    askCard.replaceChildren(
      avatar(name),
      el(
        'h2',
        { class: 'friendly-title friendly-center', id: 'friendly-ask-title' },
        FRIENDLY_TEXT.saysBattleMe(name),
      ),
      el('p', { class: 'friendly-intro friendly-center' }, FRIENDLY_TEXT.justForFun),
      el(
        'p',
        { class: 'friendly-hint friendly-center' },
        FRIENDLY_TEXT.teams(ask.fromTeamLevel, ask.toTeamLevel),
      ),
      el(
        'div',
        { class: 'friendly-answers' },
        button(
          FRIENDLY_TEXT.notNow,
          () => {
            void answer(ask, 'not-now');
          },
          { soft: true, testId: 'friendly-not-now', disabled: working },
        ),
        button(
          FRIENDLY_TEXT.battle,
          () => {
            void answer(ask, 'yes');
          },
          { testId: 'friendly-yes', disabled: working },
        ),
      ),
      el('span', { class: 'friendly-bar', 'aria-hidden': 'true' }, fill),
      el('p', { class: 'friendly-hint friendly-center' }, FRIENDLY_TEXT.floatsAway),
    );
  }

  /** Looks at the asks again when the one on screen should have floated away. */
  function armExpiry(): void {
    window.clearTimeout(askTimer);
    const times = [incoming, mode.type === 'waiting' ? mode.challenge : null].flatMap((c) =>
      c ? [Date.parse(c.expiresAt)] : [],
    );
    if (times.length === 0) return;
    const soonest = Math.min(...times);
    askTimer = window.setTimeout(
      () => {
        void load();
      },
      Math.max(0, soonest - now()) + 1000,
    );
  }

  async function load(): Promise<void> {
    const id = mapId;
    if (!id || !user) return;
    const at = ticket;
    try {
      const next = await api.view(id);
      if (at !== ticket) return;
      view = next;
      incoming = next.incoming[0] ?? null;
      if (mode.type === 'waiting') {
        const still = next.outgoing?.id === mode.challenge.id;
        if (!still) {
          // Answered, called off or floated away while we weren't looking.
          mode = { type: 'list' };
          showToast(FRIENDLY_TEXT.floatedAway);
        }
      } else if (next.outgoing && mode.type !== 'declined') {
        mode = { type: 'waiting', challenge: next.outgoing };
      }
      armExpiry();
      render();
    } catch {
      // Live events and the next open look again.
    }
  }

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  async function run<T>(work: (key: string) => Promise<T>): Promise<T | null> {
    const at = ticket;
    working = true;
    note = '';
    render();
    try {
      const result = await sendCommand(sendDeps, work, () => at === ticket);
      return at === ticket ? result : null;
    } catch (err) {
      if (at === ticket) note = messageOf(err);
      return null;
    } finally {
      if (at === ticket) {
        working = false;
        render();
      }
    }
  }

  async function ask(who: OnlineMember): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const sent = await run((key) => api.ask(id, who.userId, key));
    if (!sent) {
      // Refused (busy, a rest after "Not now!", not here): the note says why.
      if (mode.type === 'card') render();
      return;
    }
    mode = { type: 'waiting', challenge: sent };
    armExpiry();
    render();
  }

  async function cancel(challenge: ChallengeView): Promise<void> {
    if (working) return;
    const done = await run(async (key) => {
      await api.cancel(challenge.id, key);
      return true;
    });
    if (done) closeSheet();
    else void load();
  }

  async function answer(challenge: ChallengeView, reply: 'yes' | 'not-now'): Promise<void> {
    if (working) return;
    const result = await run((key) => api.answer(challenge.id, reply, key));
    incoming = null;
    renderAsk();
    if (!result) {
      // Too late, or someone is busy: say so kindly and look again.
      if (note) showToast(note);
      note = '';
      void load();
      return;
    }
    if (result.battle) {
      closeSheet();
      options.openBattle(result.battle);
    }
  }

  /** The asker's side of a "Battle!": open the battle that just started. */
  async function joinBattle(battleId: string): Promise<void> {
    const at = ticket;
    try {
      const battle = await battles.get(battleId);
      if (at !== ticket) return;
      closeSheet();
      options.openBattle(battle);
    } catch (err) {
      if (at === ticket) showToast(messageOf(err));
    }
  }

  return {
    setMap: async (next) => {
      ticket += 1;
      mapId = next;
      view = null;
      incoming = null;
      mode = { type: 'closed' };
      note = '';
      window.clearTimeout(askTimer);
      render();
      await load();
    },

    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      ticket += 1;
      mapId = null;
      view = null;
      incoming = null;
      mode = { type: 'closed' };
      window.clearTimeout(askTimer);
      render();
    },

    liveEvent: (event) => {
      if (event.mapId !== mapId || !user) return;
      const ask = challengeEventFor(event, user.id);
      if (!ask) return;
      const mine = ask.fromUserId === user.id;
      if (ask.type === 'answered' && mine) {
        if (ask.answer === 'yes' && ask.battleId) {
          void joinBattle(ask.battleId);
        } else {
          mode = { type: 'declined', name: nameOf(ask.toUserId) };
          showToast(FRIENDLY_TEXT.saidNotNow(nameOf(ask.toUserId)));
          render();
        }
        return;
      }
      if (ask.type === 'cancelled' && mine && mode.type === 'waiting') {
        mode = { type: 'list' };
        showToast(FRIENDLY_TEXT.floatedAway);
      }
      // A new ask for me, or one that went away: look again.
      void load();
    },

    get debug() {
      if (!mapId) return null;
      return {
        mapId,
        mode: mode.type,
        online: (view?.online ?? []).map((o) => o.userId),
        incoming: incoming ? [incoming.id] : [],
        outgoing: mode.type === 'waiting' ? mode.challenge.id : null,
        note,
      };
    },
  };
}
