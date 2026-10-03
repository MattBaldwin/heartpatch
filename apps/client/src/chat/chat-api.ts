import {
  QuickMessageFeedResponseSchema,
  SendQuickMessageResponseSchema,
  type QuickMessageEntry,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** Quick message calls (server: modules/chat/routes.ts). */
export const chatApi = {
  /** The patch's latest quick messages, newest last. */
  feed: (mapId: string): Promise<QuickMessageEntry[]> =>
    apiCallFor(`/maps/${mapId}/chat`, {
      method: 'GET',
      schema: QuickMessageFeedResponseSchema,
    }).then((res) => res.messages),

  /** Sends one quick message by id (never text). */
  send: (mapId: string, messageId: string, key: string): Promise<QuickMessageEntry> =>
    apiCallFor(`/maps/${mapId}/chat`, {
      method: 'POST',
      body: { messageId },
      schema: SendQuickMessageResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.message),
};

export type ChatApi = typeof chatApi;
