import type {
  PublicUser,
  QuickMessage,
  QuickMessageEntry,
  WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { chatApi, type ChatApi } from './chat-api.js';
import {
  CHAT_BUBBLE_MS,
  CHAT_FRESH_MS,
  CHAT_MAX_BUBBLES,
  CHAT_TEXT,
  entryOfEvent,
  lookOf,
  lookOfId,
  mergeFeed,
  pickerSections,
  speakerName,
  type QuickMessageLook,
} from './chat-view.js';
import './chat.css';

// Quick messages (#23, design doc §17 Phase 1): a Chat button over a
// multiplayer map opens a sheet with the patch's latest messages and the
// presets, emoji and stickers to pick from. New messages pop up as little
// bubbles over the map. Only ids travel; the words come from shared data.
// DOM only (CSS fades), so nothing redraws the 3D scene.

export interface ChatScreenOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  api?: ChatApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface ChatDebug {
  readonly mapId: string;
  readonly open: boolean;
  /** The feed, oldest first. */
  readonly feed: readonly { username: string; messageId: string }[];
  /** Bubbles over the map right now, oldest first (message ids). */
  readonly bubbles: readonly string[];
  readonly note: string;
}

export interface ChatScreen {
  /** The multiplayer map on screen (null: none): shows the Chat button and loads the feed. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** Every live event on the open map (map-screen `onLiveEvent`). */
  liveEvent: (event: WsEventMessage) => void;
  readonly debug: ChatDebug | null;
}

/** One message drawn small: a line, a big emoji, or a vinyl blob sticker. */
function drawLook(look: QuickMessageLook): HTMLElement {
  switch (look.kind) {
    case 'phrase':
      return el('span', { class: 'chat-phrase' }, look.text);
    case 'emoji':
      return el('span', { class: 'chat-emoji', role: 'img', 'aria-label': look.label }, look.emoji);
    case 'sticker': {
      const blob = el('span', { class: 'chat-sticker-blob', 'aria-hidden': 'true' });
      blob.style.background = look.color;
      return el(
        'span',
        { class: 'chat-sticker', role: 'img', 'aria-label': look.label },
        blob,
        el('span', { class: 'chat-sticker-name', 'aria-hidden': 'true' }, look.label),
      );
    }
  }
}

export function createChatScreen(options: ChatScreenOptions): ChatScreen {
  const api = options.api ?? chatApi;
  const now = options.now ?? (() => Date.now());
  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let feed: QuickMessageEntry[] = [];
  let open = false;
  let sending = false;
  let note = '';
  /** Bumped on every map and user change, so a late reply is dropped. */
  let ticket = 0;
  const bubbles: { id: string; messageId: string; node: HTMLElement; timer: number }[] = [];

  const openButton = el(
    'button',
    {
      type: 'button',
      class: 'chat-open',
      'data-testid': 'chat-open',
      'aria-label': CHAT_TEXT.open,
    },
    el('span', { class: 'chat-open-icon', 'aria-hidden': 'true' }, '💬'),
    el('span', { class: 'chat-open-label' }, CHAT_TEXT.open),
  );
  openButton.hidden = true;

  const bubbleBox = el('div', {
    class: 'chat-bubbles',
    'data-testid': 'chat-bubbles',
    'aria-live': 'polite',
  });

  const feedList = el('ol', { class: 'chat-feed', 'data-testid': 'chat-feed' });
  const noteLine = el('p', { class: 'chat-note', role: 'status', 'data-testid': 'chat-note' });
  const picker = el('div', { class: 'chat-picker' });
  const closeButton = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'chat-close' },
    CHAT_TEXT.close,
  );
  const sheet = el(
    'section',
    { class: 'chat-sheet', role: 'dialog', 'aria-labelledby': 'chat-title', 'data-testid': 'chat' },
    el('h2', { class: 'chat-title', id: 'chat-title' }, CHAT_TEXT.title),
    feedList,
    noteLine,
    picker,
    el('div', { class: 'auth-actions' }, closeButton),
  );
  sheet.hidden = true;
  (options.entryRoot ?? options.root).append(openButton);
  options.root.append(bubbleBox, sheet);

  // The picker never changes: built once from shared data.
  const pickButtons: HTMLButtonElement[] = [];
  for (const section of pickerSections()) {
    const row = el('div', { class: 'chat-pick-row' });
    for (const message of section.messages) {
      const look = lookOf(message);
      const button = el(
        'button',
        {
          type: 'button',
          class: `chat-pick chat-pick-${message.kind}`,
          'data-message': message.id,
          'aria-label': look.label,
        },
        drawLook(look),
      );
      button.addEventListener('click', () => {
        void send(message);
      });
      pickButtons.push(button);
      row.append(button);
    }
    picker.append(el('h3', { class: 'chat-section-title' }, section.title), row);
  }

  openButton.addEventListener('click', () => {
    open = true;
    note = '';
    render();
    feedList.scrollTop = feedList.scrollHeight;
  });
  closeButton.addEventListener('click', () => {
    open = false;
    note = '';
    render();
  });

  function render(): void {
    openButton.hidden = !mapId || open;
    sheet.hidden = !mapId || !open;
    noteLine.textContent = sending ? CHAT_TEXT.sending : note;
    for (const b of pickButtons) b.disabled = sending;
    const items = feed.flatMap((entry) => {
      const look = lookOfId(entry.messageId);
      if (!look) return [];
      return [
        el(
          'li',
          { class: 'chat-feed-item', 'data-message': entry.messageId },
          el('span', { class: 'chat-who' }, speakerName(entry, user?.id ?? null)),
          drawLook(look),
        ),
      ];
    });
    feedList.replaceChildren(
      ...(items.length > 0 ? items : [el('li', { class: 'chat-feed-empty' }, CHAT_TEXT.empty)]),
    );
  }

  function dropBubble(id: string): void {
    const at = bubbles.findIndex((b) => b.id === id);
    if (at < 0) return;
    for (const gone of bubbles.splice(at, 1)) {
      window.clearTimeout(gone.timer);
      gone.node.remove();
    }
  }

  function clearBubbles(): void {
    for (const b of [...bubbles]) dropBubble(b.id);
  }

  /** A little bubble over the map for a new message (once each). */
  function bubble(entry: QuickMessageEntry): void {
    const look = lookOfId(entry.messageId);
    if (!look || bubbles.some((b) => b.id === entry.id)) return;
    for (const old of bubbles.slice(0, Math.max(0, bubbles.length - CHAT_MAX_BUBBLES + 1))) {
      dropBubble(old.id);
    }
    const node = el(
      'div',
      { class: 'chat-bubble', 'data-message': entry.messageId },
      el('span', { class: 'chat-who' }, speakerName(entry, user?.id ?? null)),
      drawLook(look),
    );
    node.style.setProperty('--chat-bubble-ms', `${String(CHAT_BUBBLE_MS)}ms`);
    bubbleBox.append(node);
    const timer = window.setTimeout(() => {
      dropBubble(entry.id);
    }, CHAT_BUBBLE_MS);
    bubbles.push({ id: entry.id, messageId: entry.messageId, node, timer });
  }

  /** New messages: into the feed, and fresh ones also as bubbles. */
  function arrived(entries: readonly QuickMessageEntry[], asBubbles: boolean): void {
    const known = new Set(feed.map((m) => m.id));
    feed = mergeFeed(feed, entries);
    if (asBubbles) for (const e of entries) if (!known.has(e.id)) bubble(e);
    render();
    if (open) feedList.scrollTop = feedList.scrollHeight;
  }

  async function load(): Promise<void> {
    const id = mapId;
    if (!id) return;
    const at = ticket;
    try {
      const latest = await api.feed(id);
      if (at !== ticket) return;
      arrived(latest, false);
    } catch {
      // The feed is a nicety: live messages still arrive, and the next open tries again.
    }
  }

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  async function send(message: QuickMessage): Promise<void> {
    const id = mapId;
    if (!id || sending) return;
    const at = ticket;
    sending = true;
    note = '';
    render();
    try {
      const sent = await sendCommand(
        sendDeps,
        (key) => api.send(id, message.id, key),
        () => at === ticket,
      );
      if (at !== ticket || !sent) return;
      // Sent: the sheet steps aside so the bubble shows.
      open = false;
      arrived([sent], true);
    } catch (err) {
      if (at === ticket) note = messageOf(err);
    } finally {
      if (at === ticket) {
        sending = false;
        render();
      }
    }
  }

  return {
    setMap: async (next) => {
      ticket += 1;
      mapId = next;
      feed = [];
      open = false;
      sending = false;
      note = '';
      clearBubbles();
      render();
      await load();
    },

    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      ticket += 1;
      mapId = null;
      feed = [];
      open = false;
      sending = false;
      clearBubbles();
      render();
    },

    liveEvent: (event) => {
      if (event.mapId !== mapId) return;
      const entry = entryOfEvent(event);
      if (!entry) return;
      // A replay after reconnecting goes quietly into the feed.
      arrived([entry], now() - Date.parse(event.at) < CHAT_FRESH_MS);
    },

    get debug() {
      if (!mapId) return null;
      return {
        mapId,
        open,
        feed: feed.map((m) => ({ username: m.username, messageId: m.messageId })),
        bubbles: bubbles.map((b) => b.messageId),
        note,
      };
    },
  };
}
