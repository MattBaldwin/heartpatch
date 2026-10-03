import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import { formatDataIssues } from './issues.js';

/*
 * Quick messages (design doc §17, Phase 1): preset phrases, emoji and squishy
 * stickers. Players pick one; only its id goes over the wire, and every
 * client draws it from this data, so there is no player-typed text at all
 * (CLAUDE.md rule 9).
 */

/** A preset phrase: one short, cozy line (style guide §2). */
export const QuickPhraseSchema = z.strictObject({
  id: ContentIdSchema,
  kind: z.literal('phrase'),
  line: z.string().trim().min(1).max(40),
});

/** One emoji, with a name for screen readers. */
export const QuickEmojiSchema = z.strictObject({
  id: ContentIdSchema,
  kind: z.literal('emoji'),
  emoji: z.string().min(1).max(16),
  name: DisplayNameSchema,
});

/** A squishy sticker: a public species drawn in its vinyl colours (no image assets). */
export const QuickStickerSchema = z.strictObject({
  id: ContentIdSchema,
  kind: z.literal('sticker'),
  speciesId: ContentIdSchema,
  name: DisplayNameSchema,
});

export const QuickMessageSchema = z.discriminatedUnion('kind', [
  QuickPhraseSchema,
  QuickEmojiSchema,
  QuickStickerSchema,
]);
export type QuickMessage = z.infer<typeof QuickMessageSchema>;
export type QuickMessageKind = QuickMessage['kind'];

/** The quick message list and its rules. */
export const QuickMessageDataSchema = z
  .strictObject({
    messages: z.array(QuickMessageSchema).min(1),
    /** How many of a map's latest messages the feed shows (and the server keeps). */
    feedLimit: z.number().int().min(1).max(100),
  })
  .refine((data) => new Set(data.messages.map((m) => m.id)).size === data.messages.length, {
    message: 'Quick message ids must be unique.',
    path: ['messages'],
  });
export type QuickMessageData = z.infer<typeof QuickMessageDataSchema>;

/** Validates quick message data and returns readable problems, or `[]`. */
export function checkQuickMessages(input: unknown): string[] {
  const result = QuickMessageDataSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
