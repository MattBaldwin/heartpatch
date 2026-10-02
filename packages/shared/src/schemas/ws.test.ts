import { describe, expect, it } from 'vitest';
import {
  WsClientMessageSchema,
  WsControlMessageSchema,
  WsEventMessageSchema,
  WsServerMessageSchema,
} from './ws.js';

const MAP = '0190a8c4-0000-7000-8000-000000000001';
const event = {
  v: 1,
  type: 'tile.updated',
  mapId: MAP,
  seq: 3,
  at: '2026-10-31T21:00:00.000Z',
  data: { q: 1, r: -1 },
};

describe('WebSocket envelope', () => {
  it('accepts a game event in the spec envelope', () => {
    expect(WsEventMessageSchema.parse(event)).toEqual(event);
    expect(WsServerMessageSchema.parse(event)).toEqual(event);
  });

  it('rejects another protocol version, a zero seq, and reserved or odd type names', () => {
    expect(WsEventMessageSchema.safeParse({ ...event, v: 2 }).success).toBe(false);
    expect(WsEventMessageSchema.safeParse({ ...event, seq: 0 }).success).toBe(false);
    for (const type of ['ws.cursor', 'tile', 'Tile.Updated', 'tile..updated']) {
      expect(WsEventMessageSchema.safeParse({ ...event, type }).success).toBe(false);
    }
  });

  it('parses protocol messages by type', () => {
    const cursor = { v: 1, type: 'ws.cursor', mapId: MAP, seq: 4 };
    expect(WsControlMessageSchema.parse(cursor)).toEqual(cursor);
    const error = { v: 1, type: 'ws.error', code: 'FORBIDDEN', message: 'Nope!', mapId: MAP };
    expect(WsServerMessageSchema.parse(error)).toEqual(error);
    expect(
      WsControlMessageSchema.safeParse({ v: 1, type: 'ws.error', code: 'NOPE', message: 'x' })
        .success,
    ).toBe(false);
  });

  it('validates client messages', () => {
    const subscribe = { v: 1, type: 'subscribe', mapId: MAP, afterSeq: 0 };
    expect(WsClientMessageSchema.parse(subscribe)).toEqual(subscribe);
    expect(WsClientMessageSchema.safeParse({ ...subscribe, afterSeq: -1 }).success).toBe(false);
    expect(WsClientMessageSchema.safeParse({ ...subscribe, afterSeq: 1.5 }).success).toBe(false);
    expect(WsClientMessageSchema.safeParse({ ...subscribe, mapId: 'x' }).success).toBe(false);
    expect(WsClientMessageSchema.safeParse({ v: 1, type: 'shout' }).success).toBe(false);
  });
});
