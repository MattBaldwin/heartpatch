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

  it('registers the Wild Isle events, keeping bills and weather rolls internal (#621)', () => {
    const at = { q: 3, r: -2 };
    const tiles = [at, { q: 4, r: -2 }];
    const buildingRowId = '0190a000-0000-7000-8000-0000000000b1';
    const cases = [
      ['road.built', { userId, ...at, level: 1, cost: { timber: 4 } }, { userId, ...at, level: 1 }],
      [
        'road.upgraded',
        { userId, ...at, fromLevel: 1, level: 2, cost: { stone: 6 } },
        { userId, ...at, level: 2 },
      ],
      [
        'road.removed',
        { userId, ...at, level: 2, refund: { stone: 3 }, lost: 'captured' },
        { userId, ...at },
      ],
      [
        'building.knocked',
        {
          userId,
          buildingRowId,
          buildingId: 'river-well',
          ...at,
          frontId: 'f1',
          at: '2026-10-25T15:00:00.000Z',
        },
        { userId, buildingRowId, ...at },
      ],
      [
        'building.repaired',
        { userId, buildingRowId, ...at, cost: { timber: 5 } },
        { userId, buildingRowId, ...at },
      ],
      ['tile.stranded', { userId, tiles }, { userId, tiles }],
      ['tile.supplied', { userId, tiles }, { userId, tiles }],
    ] as const;
    for (const [type, internal, shown] of cases) {
      expect(parseGameEventPayload(type, internal), type).toEqual(internal);
      expect(GAME_EVENTS[type].public.parse(internal), type).toEqual(shown);
    }
    expect(() =>
      parseGameEventPayload('road.built', { userId, ...at, level: 4, cost: {} }),
    ).toThrow();
    expect(() => parseGameEventPayload('tile.stranded', { userId, tiles: [] })).toThrow();
    const rewilded = {
      userId,
      night: '2026-10-25',
      tiles: [{ ...at, terrain: 'coast' }],
      returnedSquishyIds: [],
    };
    expect(parseGameEventPayload('tile.rewilded', { ...rewilded, cause: 'stranded' })).toEqual({
      ...rewilded,
      cause: 'stranded',
    });
    const created = {
      name: 'Isle',
      timeZone: 'UTC',
      pvpMode: 'gentle',
      maxPlayers: 6,
      homeSlot: 0,
      heartSeed: at,
    };
    expect(parseGameEventPayload('map.created', created)).toEqual(created);
    expect(parseGameEventPayload('map.created', { ...created, patchType: 'wild-isle' })).toEqual({
      ...created,
      patchType: 'wild-isle',
    });
  });

  it('declares a plain z.object public schema for every type', () => {
    for (const type of GAME_EVENT_TYPES) {
      expect(GAME_EVENTS[type].public.def.catchall).toBeUndefined();
    }
  });
});
