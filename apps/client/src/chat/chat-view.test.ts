import {
  findAvoidedWords,
  QUICK_MESSAGES,
  type QuickMessageEntry,
  type WsEventMessage,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  CHAT_TEXT,
  entryOfEvent,
  lookOfId,
  mergeFeed,
  pickerSections,
  speakerName,
} from './chat-view.js';

const USER = '0190a8c4-0000-7000-8000-000000000001';
const PAL = '0190a8c4-0000-7000-8000-000000000002';
const entry = (n: number, at = `2026-10-31T20:00:0${String(n)}.000Z`): QuickMessageEntry => ({
  id: `0190a8c4-0000-7000-8000-00000000010${String(n)}`,
  userId: USER,
  username: 'clover',
  messageId: 'hi',
  sentAt: at,
});

describe('quick message looks', () => {
  it('draws phrases, emoji and stickers from shared data', () => {
    expect(lookOfId('getting-dark')).toEqual({
      kind: 'phrase',
      text: 'Watch out, it’s getting dark!',
      label: 'Watch out, it’s getting dark!',
    });
    expect(lookOfId('pumpkin')).toEqual({ kind: 'emoji', emoji: '🎃', label: 'Pumpkin' });
    const sticker = lookOfId('sticker-glowboo');
    expect(sticker).toMatchObject({ kind: 'sticker', label: 'Glowboo' });
    expect(sticker?.kind === 'sticker' && sticker.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('skips ids this build does not know', () => {
    expect(lookOfId('from-the-future')).toBeNull();
  });

  it('offers every message once, in three sections', () => {
    const sections = pickerSections();
    expect(sections.map((s) => s.title)).toEqual([
      CHAT_TEXT.phrases,
      CHAT_TEXT.emoji,
      CHAT_TEXT.stickers,
    ]);
    expect(sections.flatMap((s) => s.messages)).toHaveLength(QUICK_MESSAGES.messages.length);
  });

  it('keeps its own words kind (style guide §9)', () => {
    for (const line of Object.values(CHAT_TEXT)) expect(findAvoidedWords(line), line).toEqual([]);
  });

  it('says "You" for my own messages', () => {
    expect(speakerName({ userId: USER, username: 'clover' }, USER)).toBe(CHAT_TEXT.you);
    expect(speakerName({ userId: USER, username: 'clover' }, PAL)).toBe('clover');
  });
});

describe('the feed', () => {
  it('merges each message once, oldest first, keeping the latest few', () => {
    const a = entry(1);
    const b = entry(2);
    const c = entry(3);
    expect(mergeFeed([a, c], [b, c])).toEqual([a, b, c]);
    expect(mergeFeed([a, b], [c], 2)).toEqual([b, c]);
    // The first copy wins (a send's reply, then its own live event).
    expect(mergeFeed([a], [{ ...a, sentAt: '2026-10-31T21:00:00.000Z' }])).toEqual([a]);
  });

  it('reads chat.quick events, and nothing else', () => {
    const live: WsEventMessage = {
      v: 1,
      type: 'chat.quick',
      mapId: USER,
      seq: 9,
      at: '2026-10-31T16:00:00-04:00',
      data: { chatId: entry(4).id, userId: PAL, username: 'pip', messageId: 'heart' },
    };
    expect(entryOfEvent(live)).toEqual({
      id: entry(4).id,
      userId: PAL,
      username: 'pip',
      messageId: 'heart',
      sentAt: '2026-10-31T20:00:00.000Z',
    });
    expect(entryOfEvent({ ...live, data: { text: 'hello' } })).toBeNull();
    expect(entryOfEvent({ ...live, type: 'map.updated' })).toBeNull();
  });
});
