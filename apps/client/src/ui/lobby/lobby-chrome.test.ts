import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { closeListTo, LOBBY_PEEK_TEXT, lobbyChrome } from './lobby-chrome.js';

describe('lobbyChrome (#212)', () => {
  it('peeking shows the back pill and the corner button, not the list', () => {
    expect(lobbyChrome('peek')).toEqual({ panel: false, openButton: true, backPill: true });
  });

  it('the pill goes back to the list, where it hides again', () => {
    expect(lobbyChrome('list')).toEqual({ panel: true, openButton: false, backPill: false });
  });

  it('never shows the pill over an open patch, or when the lobby steps out', () => {
    expect(lobbyChrome('map')).toEqual({ panel: false, openButton: true, backPill: false });
    expect(lobbyChrome('away')).toEqual({ panel: false, openButton: false, backPill: false });
  });

  it('"Look around the world" over an open patch just goes back to that patch', () => {
    expect(closeListTo(false)).toBe('peek');
    expect(closeListTo(true)).toBe('map');
  });

  it('keeps its words kind and short', () => {
    expect(Object.values(LOBBY_PEEK_TEXT).flatMap((t) => findAvoidedWords(t))).toEqual([]);
    expect(LOBBY_PEEK_TEXT.lookAround).toBe('Look around the world');
    expect(LOBBY_PEEK_TEXT.back).toBe('← Back to my patches');
  });
});
