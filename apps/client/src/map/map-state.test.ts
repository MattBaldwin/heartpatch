import type { WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { MapState } from './map-state.js';
import { MAP_ID, testView, userId } from './test-view.js';

const event = (type: string, data: Record<string, unknown>, seq = 2): WsEventMessage => ({
  v: 1,
  type,
  mapId: MAP_ID,
  seq,
  at: '2026-10-02T12:00:00.000Z',
  data,
});

describe('MapState', () => {
  it('indexes tiles and members', () => {
    const state = new MapState(testView(2));
    expect(state.id).toBe(MAP_ID);
    expect(state.tileAt('0,0')?.terrain).toBe('junipers-gap');
    expect(state.member(userId(2))?.homeSlot).toBe(1);
    expect(state.member(userId(3))).toBeUndefined();
  });

  it('applies a settings change in place', () => {
    const state = new MapState(testView());
    expect(state.apply(event('map.updated', { pvpMode: 'off' }))).toBe('none');
    expect(state.view.map.pvpMode).toBe('off');
  });

  it('refetches rather than guessing when members (and their land) change', () => {
    const state = new MapState(testView());
    const before = state.view;
    const joined = {
      userId: userId(2),
      username: 'keeper2',
      homeSlot: 1,
      heartSeed: { q: 0, r: 8 },
    };
    expect(state.apply(event('member.joined', joined))).toBe('resync');
    expect(state.apply(event('member.left', { userId: userId(2), releasedTiles: 7 }))).toBe(
      'resync',
    );
    expect(state.apply(event('member.removed', { userId: userId(2), releasedTiles: 7 }))).toBe(
      'resync',
    );
    expect(state.view).toBe(before);
  });

  it('refetches when an event it draws from is malformed', () => {
    const state = new MapState(testView());
    expect(state.apply(event('map.updated', { pvpMode: 'sideways' }))).toBe('resync');
    expect(state.view.map.pvpMode).toBe('gentle');
  });

  it("ignores events it doesn't draw", () => {
    const state = new MapState(testView());
    const before = state.view;
    expect(state.apply(event('chat.quick', { text: 'hi' }))).toBe('none');
    expect(state.view).toBe(before);
  });

  it('swaps in a fresh view and re-indexes it', () => {
    const state = new MapState(testView(1));
    state.replace(testView(2));
    expect(state.member(userId(2))).toBeDefined();
    expect(state.view.tiles.filter((t) => t.ownerUserId === userId(2))).toHaveLength(7);
  });
});
