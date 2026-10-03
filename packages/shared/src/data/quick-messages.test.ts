import { describe, expect, it } from 'vitest';
import { checkQuickMessages } from '../schemas/data/quick-messages.js';
import { findAvoidedWords, scanPlayerFacingText } from './avoided-words.js';
import { GAME_DATA } from './index.js';
import { QUICK_MESSAGES, quickMessageById } from './quick-messages.js';
import { SERVER_GAME_DATA } from './server/index.js';

const ofKind = (kind: string) => QUICK_MESSAGES.messages.filter((m) => m.kind === kind);

describe('quick messages (#23)', () => {
  it('are valid', () => {
    expect(checkQuickMessages(QUICK_MESSAGES)).toEqual([]);
  });

  it('rejects duplicate ids and unknown kinds', () => {
    const [first] = QUICK_MESSAGES.messages;
    expect(
      checkQuickMessages({ ...QUICK_MESSAGES, messages: [...QUICK_MESSAGES.messages, first] }),
    ).not.toEqual([]);
    expect(
      checkQuickMessages({
        ...QUICK_MESSAGES,
        messages: [{ id: 'yell', kind: 'text', line: 'Hi' }],
      }),
    ).not.toEqual([]);
  });

  it('has a handful of phrases, emoji and stickers (design doc §17)', () => {
    expect(ofKind('phrase').length).toBeGreaterThanOrEqual(12);
    expect(ofKind('phrase').length).toBeLessThanOrEqual(16);
    expect(ofKind('emoji').length).toBeGreaterThanOrEqual(8);
    expect(ofKind('sticker').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps phrases short and kind (style guide §2, §9)', () => {
    expect(scanPlayerFacingText(QUICK_MESSAGES, 'QUICK_MESSAGES')).toEqual([]);
    for (const m of QUICK_MESSAGES.messages) {
      if (m.kind !== 'phrase') continue;
      expect(m.line.split(/\s+/).length, m.id).toBeLessThanOrEqual(6);
      expect(findAvoidedWords(m.line), m.id).toEqual([]);
    }
  });

  it('draws stickers only from public species, never secret ones (CLAUDE.md rule 6)', () => {
    const publicIds = new Set(GAME_DATA.species.map((s) => s.id));
    const secretIds = new Set(SERVER_GAME_DATA.secretSpecies.map((s) => s.id));
    for (const m of QUICK_MESSAGES.messages) {
      if (m.kind !== 'sticker') continue;
      expect(publicIds.has(m.speciesId), m.id).toBe(true);
      expect(secretIds.has(m.speciesId), m.id).toBe(false);
      expect(GAME_DATA.species.find((s) => s.id === m.speciesId)?.rarity, m.id).not.toBe('secret');
    }
  });

  it('looks messages up by id', () => {
    expect(quickMessageById('thank-you')).toMatchObject({ kind: 'phrase', line: 'Thank you!' });
    expect(quickMessageById('nope')).toBeUndefined();
  });
});
