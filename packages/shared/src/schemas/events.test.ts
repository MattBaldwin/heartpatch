import { describe, expect, it } from 'vitest';
import {
  GAME_EVENTS,
  GameEventTypeSchema,
  isGameEventType,
  parseGameEventPayload,
  publicGameEventPayload,
} from './events.js';

const userId = '0190a000-0000-7000-8000-000000000001';

describe('game event registry', () => {
  it('names every type noun.past-tense-verb', () => {
    for (const type of Object.keys(GAME_EVENTS)) {
      expect(type).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(isGameEventType(type)).toBe(true);
      expect(GameEventTypeSchema.parse(type)).toBe(type);
    }
    expect(isGameEventType('tile.exploded')).toBe(false);
    expect(isGameEventType('toString')).toBe(false);
  });

  it('checks internal payloads strictly', () => {
    const payload = { userId, username: 'pumpkinpal', homeSlot: 1, heartSeed: { q: 4, r: -8 } };
    expect(parseGameEventPayload('member.joined', payload)).toEqual(payload);
    expect(() => parseGameEventPayload('member.joined', { ...payload, extra: 1 })).toThrow();
    expect(() => parseGameEventPayload('map.updated', { pvpMode: 'wild' })).toThrow();
  });

  it('builds public views from the public schema only', () => {
    expect(
      publicGameEventPayload('map.created', {
        name: 'Pumpkin Hollow',
        timeZone: 'America/Chicago',
        pvpMode: 'gentle',
        maxPlayers: 4,
        homeSlot: 0,
        heartSeed: { q: 8, r: 0 },
      }),
    ).toEqual({ name: 'Pumpkin Hollow', pvpMode: 'gentle' });
    expect(publicGameEventPayload('member.left', { userId, releasedTiles: 7 })).toEqual({
      userId,
      releasedTiles: 7,
    });
  });
});
