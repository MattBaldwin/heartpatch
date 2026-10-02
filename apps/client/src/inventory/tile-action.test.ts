import { findAvoidedWords, GAME_DATA, type Gather, type PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { userId } from '../map/test-view.js';
import { tileAction } from './tile-action.js';

const me = userId(1);
const NOW = Date.parse('2026-10-02T12:00:00Z');
const timber = GAME_DATA.resources.find((r) => r.id === 'timber')!.gather!;

const tile = (extra: Partial<PublicTile>): PublicTile => ({
  q: 1,
  r: 0,
  terrain: 'forest',
  ownerUserId: me,
  nodeResource: 'timber',
  homeSlot: 0,
  gathering: null,
  cooldownUntil: null,
  defenders: 0,
  ...extra,
});

const gather = (readyAt: string): Gather => ({
  id: '0190a8c4-0000-7000-8000-0000000000aa',
  q: 1,
  r: 0,
  resource: 'timber',
  items: { timber: timber.quantity },
  startedAt: '2026-10-02T11:50:00Z',
  readyAt,
});

const none = { gathers: [], seasons: ['halloween'] };

describe('tileAction', () => {
  it('offers Gather on your own free node, with what it gives', () => {
    expect(tileAction(tile({}), me, none, NOW)).toEqual({
      kind: 'gather',
      yields: { timber: timber.quantity },
    });
  });

  it('adds Witch Dust to Emberwood only while Halloween is on', () => {
    const ember = tile({ terrain: 'old-forest', nodeResource: 'emberwood' });
    expect(tileAction(ember, me, none, NOW)).toMatchObject({
      yields: { 'witch-dust': 1 },
    });
    const after = tileAction(ember, me, { gathers: [], seasons: [] }, NOW);
    expect(after).toMatchObject({ kind: 'gather' });
    expect(after.kind === 'gather' && after.yields['witch-dust']).toBeFalsy();
  });

  it('waits, then collects, on the game clock', () => {
    const going = gather('2026-10-02T12:05:00Z');
    expect(tileAction(tile({}), me, { gathers: [going], seasons: [] }, NOW)).toEqual({
      kind: 'waiting',
      gather: going,
    });
    expect(
      tileAction(tile({}), me, { gathers: [going], seasons: [] }, Date.parse(going.readyAt)),
    ).toEqual({ kind: 'collect', gather: going });
  });

  it('lets pumpkin patches sleep outside Halloween', () => {
    const patch = tile({ terrain: 'pumpkin-fields', nodeResource: 'pumpkins' });
    expect(tileAction(patch, me, none, NOW)).toMatchObject({ kind: 'gather' });
    const asleep = tileAction(patch, me, { gathers: [], seasons: ['thanksgiving'] }, NOW);
    expect(asleep).toEqual({
      kind: 'sleeping',
      note: 'Pumpkins only turn up around Halloween!',
    });
    expect(asleep.kind === 'sleeping' && findAvoidedWords(asleep.note)).toEqual([]);
  });

  it("shows someone else's gather, and nothing on bare or wild land", () => {
    const theirs = tile({
      ownerUserId: userId(2),
      gathering: { readyAt: '2026-10-02T12:10:00Z' },
    });
    expect(tileAction(theirs, me, none, NOW)).toEqual({
      kind: 'busy',
      readyAt: '2026-10-02T12:10:00Z',
    });
    expect(tileAction(tile({ ownerUserId: userId(2) }), me, none, NOW)).toEqual({ kind: 'none' });
    expect(tileAction(tile({ ownerUserId: null }), me, none, NOW)).toEqual({ kind: 'none' });
    expect(tileAction(tile({ nodeResource: null }), me, none, NOW)).toEqual({ kind: 'none' });
    expect(tileAction(tile({}), null, none, NOW)).toEqual({ kind: 'none' });
  });
});
