import type { WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { lineFor, newsOf, PATCH_LINE, PatchLineQueue } from './patch-line.js';

const MAP = '0190a8c4-0000-7000-8000-000000000001';
const SAM = '0190a8c4-0000-7000-8000-000000000002';
const names = {
  player: (id: string) => (id === SAM ? 'Sam' : null),
  kind: (id: string) => (id === 'thunderplume' ? 'Thunderplume' : null),
};

function celebrated(data: Record<string, unknown>, at = '2026-10-31T21:00:00Z'): WsEventMessage {
  return { v: 1, type: 'squishy.celebrated', mapId: MAP, seq: 9, at, data } as WsEventMessage;
}

describe('the patch line (#391)', () => {
  it('names the kind to a player who has met it, and only its tier to everyone else', () => {
    const named = newsOf(
      celebrated({ userId: SAM, rarity: 'legendary', speciesId: 'thunderplume' }),
      MAP,
    );
    expect(lineFor(named!, names)).toBe('🌟 Sam befriended a Legendary Thunderplume!');
    const blind = newsOf(celebrated({ userId: SAM, rarity: 'legendary' }), MAP);
    expect(lineFor(blind!, names)).toBe('🌟 Sam befriended a Legendary squishy!');
  });

  it('says "Someone" for a player it can’t name, never an id', () => {
    const news = newsOf(
      celebrated({ userId: '0190a8c4-0000-7000-8000-000000000009', rarity: 'legendary' }),
      MAP,
    );
    expect(lineFor(news!, names)).toBe('🌟 Someone befriended a Legendary squishy!');
  });

  it('only tells of tiers that tell the patch: never Epic, Rare or a secret kind', () => {
    for (const rarity of ['rare', 'epic', 'secret', 'common']) {
      const news = newsOf(celebrated({ userId: SAM, rarity }), MAP);
      expect(news && lineFor(news, names)).toBeNull();
    }
  });

  it('ignores other maps, other events and bad data', () => {
    expect(newsOf(celebrated({ userId: SAM, rarity: 'legendary' }), 'another-map')).toBeNull();
    expect(
      newsOf({ ...celebrated({}), type: 'squishy.captured' } as WsEventMessage, MAP),
    ).toBeNull();
    expect(newsOf(celebrated({ userId: 'nope', rarity: 'legendary' }), MAP)).toBeNull();
  });

  it('drops old news, keeps a few lines at most, and hands them out oldest first', () => {
    const queue = new PatchLineQueue();
    const now = 1_000_000_000;
    queue.add('stale', now - PATCH_LINE.staleMs - 1, now);
    expect(queue.size).toBe(0);
    for (let i = 0; i < PATCH_LINE.maxQueued + 2; i++) queue.add(`line ${String(i)}`, now, now);
    expect(queue.size).toBe(PATCH_LINE.maxQueued);
    expect(queue.take(now)).toBe('line 2');
    // Lines that waited too long go unseen.
    expect(queue.take(now + PATCH_LINE.staleMs + 1)).toBeNull();
    expect(queue.size).toBe(0);
  });
});
