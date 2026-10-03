import {
  QUICK_MESSAGES,
  quickMessageById,
  type PublicUser,
  type QuickMessageEntry,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { requireMember } from '../maps/members.js';
import { createChatRepo, type QuickMessageRow } from './repo.js';

/*
 * Quick messages (#23, design doc §17 Phase 1). A member picks a preset
 * phrase, emoji or sticker; the client sends only its id, the server checks
 * it against the shared `QUICK_MESSAGES`, stores it with the sender and
 * broadcasts `chat.quick`. Every client draws the words from the same data,
 * so no player-typed text exists to filter (CLAUDE.md rule 9). The route's
 * rate limits stand in for owner mute until Phase 2 (tech spec §5). Each
 * send keeps only the map's latest `feedLimit` messages.
 */

export interface ChatService {
  /** The map's latest quick messages, newest last (on open and reconnect). */
  feed: (user: PublicUser, mapId: string) => Promise<QuickMessageEntry[]>;
  /** Sends one quick message to everyone on the map. */
  send: (user: PublicUser, mapId: string, messageId: string) => Promise<QuickMessageEntry>;
}

export interface ChatServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** How many messages a map keeps and the feed shows (`QUICK_MESSAGES.feedLimit`). */
  feedLimit?: number;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  unknown: "We don't know that message. Pick one from the list!",
  tutorial: 'The Tutorial Glade is a quiet spot. Chat opens on your patch!',
} as const;

const toEntry = (row: QuickMessageRow): QuickMessageEntry => ({
  id: row.id,
  userId: row.userId,
  username: row.username,
  messageId: row.messageId,
  sentAt: row.sentAt.toISOString(),
});

/** Members only, and never on a tutorial map (it has one player and Sprout). */
async function requireChatMember(db: Executor, user: PublicUser, mapId: string): Promise<void> {
  const { map } = await requireMember(db, user, mapId);
  if (map.kind === 'tutorial') throw new AppError('FORBIDDEN', MESSAGES.tutorial);
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const feedLimit = options.feedLimit ?? QUICK_MESSAGES.feedLimit;
  const store = createChatRepo(db);

  return {
    feed: async (user, mapId) => {
      await requireChatMember(db, user, mapId);
      return (await store.latest(mapId, feedLimit)).map(toEntry);
    },

    send: async (user, mapId, messageId) => {
      if (!quickMessageById(messageId)) throw new AppError('VALIDATION_FAILED', MESSAGES.unknown);
      const sentAt = now();
      const entry = await store.transaction(async (repo, tx) => {
        await requireChatMember(tx, user, mapId);
        const { id } = await repo.insert({ mapId, userId: user.id, messageId, sentAt });
        await repo.prune(mapId, feedLimit);
        // Last write: takes the `maps` lock (tech spec §7 lock order).
        await repo.appendEvent({
          mapId,
          type: 'chat.quick',
          actorUserId: user.id,
          payload: { chatId: id, userId: user.id, username: user.username, messageId },
        });
        return toEntry({ id, userId: user.id, username: user.username, messageId, sentAt });
      });
      void options.publish?.(mapId);
      return entry;
    },
  };
}
