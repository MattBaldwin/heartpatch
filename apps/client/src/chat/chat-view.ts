import {
  GAME_DATA,
  GAME_EVENTS,
  QUICK_MESSAGES,
  quickMessageById,
  type QuickMessage,
  type QuickMessageEntry,
  type WsEventMessage,
} from '@heartpatch/shared';
import { blobColor } from '../care/care-view.js';

// Quick messages (#23): what the picker offers and how a sent message reads.
// Pure, so it's unit-tested; the words always come from shared data, never
// from the wire (CLAUDE.md rule 9).

/** Player-facing text (style guide §6). */
export const CHAT_TEXT = {
  open: 'Chat',
  title: 'Say hi!',
  close: 'Close',
  empty: 'No messages yet. Say hi!',
  phrases: 'Say',
  emoji: 'Emoji',
  stickers: 'Stickers',
  you: 'You',
  sending: 'Sending…',
} as const;

/** How long a bubble stays over the map. */
export const CHAT_BUBBLE_MS = 6_000; // TUNE: guess; long enough to read twice
/** At most this many bubbles at once; the oldest goes first. */
export const CHAT_MAX_BUBBLES = 3; // TUNE: guess
/** A live event older than this (a replay after reconnecting) goes in the feed, not a bubble. */
export const CHAT_FRESH_MS = 30_000; // TUNE: guess

const SPECIES = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/** How one quick message is drawn. */
export type QuickMessageLook =
  | { kind: 'phrase'; text: string; label: string }
  | { kind: 'emoji'; emoji: string; label: string }
  | { kind: 'sticker'; color: string; label: string };

export function lookOf(message: QuickMessage): QuickMessageLook {
  switch (message.kind) {
    case 'phrase':
      return { kind: 'phrase', text: message.line, label: message.line };
    case 'emoji':
      return { kind: 'emoji', emoji: message.emoji, label: message.name };
    case 'sticker':
      return { kind: 'sticker', color: blobColor(message.speciesId, SPECIES), label: message.name };
  }
}

/** The look of a sent message, or null for an id this build doesn't know (a newer server). */
export function lookOfId(messageId: string): QuickMessageLook | null {
  const message = quickMessageById(messageId);
  return message ? lookOf(message) : null;
}

/** The picker's sections, in data order. */
export function pickerSections(): { title: string; messages: QuickMessage[] }[] {
  const of = (kind: QuickMessage['kind']) => QUICK_MESSAGES.messages.filter((m) => m.kind === kind);
  return [
    { title: CHAT_TEXT.phrases, messages: of('phrase') },
    { title: CHAT_TEXT.emoji, messages: of('emoji') },
    { title: CHAT_TEXT.stickers, messages: of('sticker') },
  ];
}

/** Who said it, as the feed shows it. */
export function speakerName(
  entry: Pick<QuickMessageEntry, 'userId' | 'username'>,
  myId: string | null,
): string {
  return entry.userId === myId ? CHAT_TEXT.you : entry.username;
}

/**
 * Adds messages to a feed: each once (by row id, so a send's reply and its
 * own live event merge), oldest first, the latest `limit` kept.
 */
export function mergeFeed(
  feed: readonly QuickMessageEntry[],
  more: readonly QuickMessageEntry[],
  limit = QUICK_MESSAGES.feedLimit,
): QuickMessageEntry[] {
  const byId = new Map(feed.map((m) => [m.id, m]));
  // First seen wins: a live event's time is the server's commit, a reply's is the send.
  for (const m of more) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()]
    .sort((a, b) =>
      a.sentAt === b.sentAt
        ? a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0
        : a.sentAt < b.sentAt
          ? -1
          : 1,
    )
    .slice(-limit);
}

/** A `chat.quick` live event as a feed entry; null for any other event (or a bad one). */
export function entryOfEvent(event: WsEventMessage): QuickMessageEntry | null {
  if (event.type !== 'chat.quick') return null;
  const parsed = GAME_EVENTS['chat.quick'].public.safeParse(event.data);
  if (!parsed.success) return null;
  const { chatId, userId, username, messageId } = parsed.data;
  return { id: chatId, userId, username, messageId, sentAt: new Date(event.at).toISOString() };
}
