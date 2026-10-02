import { describe, expect, it } from 'vitest';
import {
  GAME_EVENT_TYPES,
  GAME_EVENTS,
  GameEventTypeSchema,
  isGameEventType,
  parseGameEventPayload,
} from './events.js';
import { WsEventTypeSchema } from './ws.js';

const userId = '0190a000-0000-7000-8000-000000000001';

describe('game event registry', () => {
  it('names every type noun.past-tense-verb', () => {
    for (const type of Object.keys(GAME_EVENTS)) {
      expect(type).toMatch(/^[a-z]+\.[a-z]+$/);
      // The live-sync hub refuses anything its wire schema can't carry.
      expect(WsEventTypeSchema.parse(type)).toBe(type);
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

  it('declares a plain z.object public schema for every type', () => {
    for (const type of GAME_EVENT_TYPES) {
      expect(GAME_EVENTS[type].public.def.catchall).toBeUndefined();
    }
  });
});
