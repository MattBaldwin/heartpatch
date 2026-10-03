import { desc, eq, inArray } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { quickMessages, users } from '../../db/schema.js';

/** A `quick_messages` row with its sender's name. */
export interface QuickMessageRow {
  id: string;
  userId: string;
  username: string;
  messageId: string;
  sentAt: Date;
}

/** Quick message storage (#23). Plain queries; the service decides the rules. */
export interface ChatRepo {
  transaction: <T>(fn: (repo: ChatTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The map's latest `limit` messages, newest last. */
  latest: (mapId: string, limit: number) => Promise<QuickMessageRow[]>;
}

export interface ChatTxRepo extends ChatRepo {
  insert: (row: { mapId: string; userId: string; messageId: string; sentAt: Date }) => Promise<{
    id: string;
  }>;
  /**
   * Deletes all but the map's newest `keep` messages. Rows another send is
   * already pruning are skipped (`skip locked`), so prunes never wait on each
   * other or deadlock; whatever one skips, the next send prunes.
   */
  prune: (mapId: string, keep: number) => Promise<void>;
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

export function createChatRepo(db: Executor): ChatRepo {
  return queries(db);
}

function createChatTxRepo(tx: Transaction): ChatTxRepo {
  return {
    ...queries(tx),

    insert: async (row) => {
      const [inserted] = await tx
        .insert(quickMessages)
        .values(row)
        .returning({ id: quickMessages.id });
      if (!inserted) throw new Error('quick_messages insert returned no row');
      return inserted;
    },

    prune: async (mapId, keep) => {
      const old = await tx
        .select({ id: quickMessages.id })
        .from(quickMessages)
        .where(eq(quickMessages.mapId, mapId))
        .orderBy(desc(quickMessages.sentAt), desc(quickMessages.id))
        .offset(keep)
        .for('update', { skipLocked: true });
      if (old.length === 0) return;
      await tx.delete(quickMessages).where(
        inArray(
          quickMessages.id,
          old.map((r) => r.id),
        ),
      );
    },

    appendEvent: (event) => appendGameEvent(tx, event),
  };
}

function queries(db: Executor): ChatRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createChatTxRepo(tx), tx)),

    latest: async (mapId, limit) => {
      const newest = await db
        .select({
          id: quickMessages.id,
          userId: quickMessages.userId,
          username: users.username,
          messageId: quickMessages.messageId,
          sentAt: quickMessages.sentAt,
        })
        .from(quickMessages)
        .innerJoin(users, eq(users.id, quickMessages.userId))
        .where(eq(quickMessages.mapId, mapId))
        .orderBy(desc(quickMessages.sentAt), desc(quickMessages.id))
        .limit(limit);
      return newest.reverse();
    },
  };
}
