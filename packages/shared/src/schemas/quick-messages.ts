import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';

/*
 * Quick messages API (#23, design doc §17 Phase 1). The client sends only a
 * message id from `QUICK_MESSAGES`; the server checks it, stores it with the
 * sender and broadcasts `chat.quick`. Clients draw the words from shared
 * data, so no player text ever travels (CLAUDE.md rule 9).
 */

/** `POST /api/v1/maps/:mapId/chat` */
export const SendQuickMessageRequestSchema = z.strictObject({ messageId: ContentIdSchema });
export type SendQuickMessageRequest = z.infer<typeof SendQuickMessageRequestSchema>;

/** One sent quick message, as the feed shows it. */
export const QuickMessageEntrySchema = z.object({
  /** The `quick_messages` row (also `chat.quick`'s `chatId`, so a feed and live events merge). */
  id: z.uuid(),
  userId: z.uuid(),
  username: z.string(),
  messageId: ContentIdSchema,
  sentAt: z.iso.datetime(),
});
export type QuickMessageEntry = z.infer<typeof QuickMessageEntrySchema>;

export const SendQuickMessageResponseSchema = z.object({ message: QuickMessageEntrySchema });
export type SendQuickMessageResponse = z.infer<typeof SendQuickMessageResponseSchema>;

/** `GET /api/v1/maps/:mapId/chat`: the map's latest messages, newest last. */
export const QuickMessageFeedResponseSchema = z.object({
  messages: z.array(QuickMessageEntrySchema),
});
export type QuickMessageFeedResponse = z.infer<typeof QuickMessageFeedResponseSchema>;
