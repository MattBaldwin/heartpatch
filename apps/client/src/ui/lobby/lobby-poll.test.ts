import type { MyMapsResponse } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { joinedSince, listKey } from './lobby-poll.js';

const owner = { id: '0190f000-0000-7000-8000-00000000000a', username: 'ana' };
const map = (id: string, name: string, memberCount = 1) =>
  ({
    id,
    name,
    role: 'member',
    owner,
    memberCount,
    maxPlayers: 4,
    pvpMode: 'gentle',
    pendingRequests: 0,
  }) as MyMapsResponse['maps'][number];
const request = (id: string, mapName: string) => ({
  id,
  mapName,
  owner,
  createdAt: '2026-10-05T10:00:00.000Z',
});

describe('the waiting row (#145)', () => {
  const waiting: MyMapsResponse = { maps: [], requests: [request('r1', 'Pickle Hollow')] };
  const joined: MyMapsResponse = { maps: [map('m1', 'Pickle Hollow', 2)], requests: [] };

  it('notices when the owner says yes', () => {
    expect(listKey(joined)).not.toBe(listKey(waiting));
    expect(joinedSince(waiting, joined)).toEqual(['Pickle Hollow']);
  });

  it('stays put while nothing changed, whatever the order', () => {
    const a: MyMapsResponse = {
      maps: [map('m1', 'A'), map('m2', 'B')],
      requests: [request('r1', 'C'), request('r2', 'D')],
    };
    const b: MyMapsResponse = {
      maps: [map('m2', 'B'), map('m1', 'A')],
      requests: [request('r2', 'D'), request('r1', 'C')],
    };
    expect(listKey(a)).toBe(listKey(b));
    expect(joinedSince(a, b)).toEqual([]);
  });

  it('notices a "no thanks" too: the request just goes away', () => {
    expect(listKey({ maps: [], requests: [] })).not.toBe(listKey(waiting));
    expect(joinedSince(waiting, { maps: [], requests: [] })).toEqual([]);
  });
});
