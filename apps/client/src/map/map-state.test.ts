import { hexKey, type WsEventMessage } from '@heartpatch/shared';
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
    expect(
      state.apply(
        event('tile.rewilded', { userId: userId(2), night: '2026-10-14', tiles: [{ q: 3, r: 0 }] }),
      ),
    ).toBe('resync');
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

  it("follows a tile's gathering live: started, then collected (#17)", () => {
    const view = testView(1);
    const node = view.tiles.find((t) => t.ownerUserId === userId(1) && t.nodeResource)!;
    const gathering = { readyAt: '2026-10-02T12:15:00.000Z' };
    const state = new MapState(view);
    const key = hexKey(node);
    expect(state.tileAt(key)?.gathering).toBeNull();
    const started = { userId: userId(1), q: node.q, r: node.r, ...gathering };
    expect(state.apply(event('gather.started', started))).toBe('none');
    expect(state.tileAt(key)?.gathering).toEqual(gathering);
    const collected = { userId: userId(1), q: node.q, r: node.r, resource: node.nodeResource };
    expect(state.apply(event('resource.gathered', collected))).toBe('none');
    expect(state.tileAt(key)?.gathering).toBeNull();
    expect(state.view.tiles.find((t) => t.q === node.q && t.r === node.r)?.gathering).toBeNull();
    expect(state.apply(event('resource.gathered', { q: 'here' }))).toBe('resync');
  });

  it("dresses a member's Keeper live when their outfit changes (#43)", () => {
    const state = new MapState(testView(2));
    const changed = { userId: userId(2), wearing: ['witch-hat', 'ghost-cape'] };
    expect(state.apply(event('outfit.changed', changed))).toBe('redraw');
    expect(state.member(userId(2))?.keeper?.wearing).toEqual(['witch-hat', 'ghost-cape']);
    expect(state.view.members[1]?.keeper?.wearing).toEqual(['witch-hat', 'ghost-cape']);
    expect(state.member(userId(1))?.keeper?.wearing).toEqual([]);
    // Someone this copy doesn't have: nothing to draw. Malformed: refetch.
    expect(state.apply(event('outfit.changed', { userId: userId(9), wearing: [] }))).toBe('none');
    expect(state.apply(event('outfit.changed', { userId: userId(2) }))).toBe('resync');
    // A find is the wardrobe's business, not the map's.
    expect(state.apply(event('clothing.found', { userId: userId(2), itemId: 'witch-hat' }))).toBe(
      'none',
    );
  });

  it('follows squishy gatherers from tile to tile, and drops them on capture', () => {
    const state = new MapState(testView(2));
    const a = { q: 1, r: 0 };
    const b = { q: 2, r: 0 };
    const assigned = (from: object | null, to: object | null, seq: number) =>
      event('squishy.assigned', { userId: userId(1), from, to }, seq);
    expect(state.apply(assigned(null, a, 2))).toBe('redraw');
    expect(state.tileAt(hexKey(a))?.workers).toBe(1);
    expect(state.apply(assigned(a, b, 3))).toBe('redraw');
    expect(state.tileAt(hexKey(a))?.workers).toBe(0);
    expect(state.tileAt(hexKey(b))?.workers).toBe(1);
    // A team pick moves nobody on the map.
    expect(state.apply(assigned(null, null, 4))).toBe('none');
    expect(state.apply(event('squishy.assigned', { userId: userId(1) }, 5))).toBe('resync');
    state.apply(event('tile.captured', { userId: userId(2), fromUserId: userId(1), ...b }, 6));
    expect(state.tileAt(hexKey(b))?.workers).toBe(0);
  });

  it('follows battles for land live: cooldown, capture and guards (#15)', () => {
    const view = testView(2);
    // A wild tile next to player 1's home ring.
    const mine = new Set(view.tiles.filter((t) => t.ownerUserId === userId(1)).map(hexKey));
    const wild = view.tiles.find(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, -1],
          [-1, 1],
        ].some(([dq, dr]) => mine.has(hexKey({ q: t.q + dq!, r: t.r + dr! }))),
    )!;
    const key = hexKey(wild);
    const state = new MapState({
      ...view,
      tiles: view.tiles.map((t) =>
        t === wild
          ? {
              ...t,
              gathering: { readyAt: 'x' },
              guardianHint: { count: 2, difficulty: 'tough' as const },
            }
          : t,
      ),
    });
    const cooldownUntil = '2026-10-02T16:00:00.000Z';
    const at = { q: wild.q, r: wild.r };
    const attacked = { attackerUserId: userId(1), defenderUserId: null, ...at, cooldownUntil };
    expect(state.apply(event('tile.attacked', attacked))).toBe('redraw');
    expect(state.tileAt(key)?.cooldownUntil).toBe(cooldownUntil);

    expect(state.apply(event('defenders.changed', { userId: userId(2), ...at, count: 2 }))).toBe(
      'redraw',
    );
    expect(state.tileAt(key)?.defenders).toBe(2);

    const captured = { userId: userId(1), fromUserId: null, ...at };
    expect(state.apply(event('tile.captured', captured))).toBe('redraw');
    // Someone's land now: its wild guardians went home with the hint.
    expect(state.tileAt(key)).toMatchObject({
      ownerUserId: userId(1),
      defenders: 0,
      gathering: null,
      guardianHint: null,
    });
    expect(state.view.tiles.find((t) => hexKey(t) === key)?.ownerUserId).toBe(userId(1));

    // A tile this map doesn't have changes nothing; a garbled event refetches.
    expect(state.apply(event('tile.captured', { ...captured, q: 999 }))).toBe('none');
    expect(state.apply(event('tile.captured', { q: 'here' }))).toBe('resync');
  });

  it('swaps in a fresh view and re-indexes it', () => {
    const state = new MapState(testView(1));
    state.replace(testView(2));
    expect(state.member(userId(2))).toBeDefined();
    expect(state.view.tiles.filter((t) => t.ownerUserId === userId(2))).toHaveLength(7);
  });

  it('applies building events to the tile they happen on (#18)', () => {
    const state = new MapState(testView(1));
    const home = state.view.tiles.find((t) => t.homeSlot === 0)!;
    const other = state.view.tiles.find((t) => t.homeSlot === 0 && t !== home)!;
    const building = {
      id: '0190a8c4-0000-7000-8000-0000000000f1',
      buildingId: 'hearthfire',
      kind: 'hearthfire',
      level: 1,
      spot: 2,
      lit: false,
      safeRadius: 1,
      q: home.q,
      r: home.r,
    };
    const tileOf = (t: { q: number; r: number }) => state.tileAt(hexKey(t))!;
    expect(state.apply(event('building.placed', { userId: userId(1), building }))).toBe('none');
    expect(tileOf(home).buildings).toEqual([
      {
        id: building.id,
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        level: 1,
        spot: 2,
        lit: false,
        safeRadius: 1,
      },
    ]);
    state.apply(
      event('building.fueled', { userId: userId(1), building: { ...building, lit: true } }, 3),
    );
    expect(tileOf(home).buildings[0]?.lit).toBe(true);
    // An upgrade: friends see the new level and the fire's longer reach.
    state.apply(
      event(
        'building.upgraded',
        { userId: userId(1), building: { ...building, lit: true, level: 2, safeRadius: 2 } },
        4,
      ),
    );
    expect(tileOf(home).buildings[0]).toMatchObject({ level: 2, safeRadius: 2, lit: true });
    const moved = { ...building, lit: true, q: other.q, r: other.r, spot: 4 };
    state.apply(
      event(
        'building.moved',
        { userId: userId(1), from: { q: home.q, r: home.r, spot: 2 }, building: moved },
        5,
      ),
    );
    expect(tileOf(home).buildings).toEqual([]);
    expect(tileOf(other).buildings.map((b) => b.spot)).toEqual([4]);
    state.apply(
      event(
        'building.removed',
        { userId: userId(1), buildingRowId: building.id, q: other.q, r: other.r },
        6,
      ),
    );
    expect(tileOf(other).buildings).toEqual([]);
    expect(state.apply(event('building.placed', { userId: userId(1) }, 7))).toBe('resync');
  });
});
