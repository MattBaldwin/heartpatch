import { describe, expect, it } from 'vitest';
import type { MapMember, MapView, PublicTile } from '../schemas/maps.js';
import type { PublicBuilding } from '../schemas/buildings.js';
import { PatchStatsSchema } from '../schemas/patch-stats.js';
import { patchStats, type MemberCounts } from './patch-stats.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const member = (id: string, name: string, homeSlot: number): MapMember => ({
  user: { id, username: name },
  role: id === A ? 'owner' : 'member',
  homeSlot,
  joinedAt: '2026-10-01T00:00:00.000Z',
  keeper: null,
  title: null,
});

let n = 0;
const building = (buildingId: string, lit: boolean | null = null, radius: number | null = null) =>
  ({
    id: `00000000-0000-4000-9000-${String((n += 1)).padStart(12, '0')}`,
    buildingId,
    kind: buildingId === 'hearthfire' ? 'hearthfire' : 'habitat',
    level: 1,
    spot: 0,
    lit,
    safeRadius: radius,
  }) as PublicBuilding;

const tile = (q: number, r: number, extra: Partial<PublicTile> = {}): PublicTile => ({
  q,
  r,
  terrain: 'meadow',
  ownerUserId: null,
  nodeResource: null,
  homeSlot: null,
  gathering: null,
  cooldownUntil: null,
  defenders: 0,
  guardianHint: null,
  buildings: [],
  ...extra,
});

const view = (tiles: PublicTile[], members: MapMember[]): MapView => ({
  map: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test',
    timeZone: 'UTC',
    pvpMode: 'on',
    maxPlayers: 4,
  },
  members,
  tiles,
  seq: 0,
});

describe('patchStats (#573)', () => {
  const members = [member(A, 'ada', 0), member(B, 'bo', 1), member(C, 'cy', 2)];
  // A 5 × 1 strip plus one more row, so a radius-1 fire lights a few tiles.
  const tiles = [
    tile(0, 0, { ownerUserId: A, homeSlot: 0, buildings: [building('hearthfire', true, 1)] }),
    tile(1, 0, { ownerUserId: A, homestead: 'joined', buildings: [building('cozy-meadow')] }),
    tile(2, 0, { ownerUserId: B, homeSlot: 1, buildings: [building('hearthfire', false, 1)] }),
    tile(3, 0, { ownerUserId: B, homestead: 'paused' }),
    tile(4, 0, { ownerUserId: B }),
    tile(5, 0),
    tile(6, 0, { homeSlot: 3 }),
    tile(7, 0, { terrain: 'trading-post' }),
    tile(8, 0, { communityId: '00000000-0000-4000-8000-0000000000aa' }),
    // C's small fire lights a tile A's fire lights too: the patch counts it once.
    tile(0, 1, { ownerUserId: C, homeSlot: 2, buildings: [building('hearthfire', true, 0)] }),
  ];
  const counts = new Map<string, MemberCounts>([
    [A, { befriended: 4, species: 2 }],
    [B, { befriended: 4, species: 3 }],
  ]);
  const stats = patchStats(view(tiles, members), counts);
  const of = (id: string) => stats.keepers.find((k) => k.user.id === id);

  it('parses as the endpoint reply', () => {
    expect(PatchStatsSchema.parse(stats)).toEqual(stats);
  });

  it('adds up the patch: claimed, wild still to claim, and lit', () => {
    // Wild: only (5,0). Not an open home, the post, or the village.
    expect(stats.totals).toEqual({ claimed: 6, wild: 1, lit: 3, villages: null });
  });

  it("counts each Keeper's land, homesteads, buildings and light", () => {
    expect(of(A)).toMatchObject({
      tiles: 2,
      homesteads: 1,
      buildings: [
        { buildingId: 'cozy-meadow', count: 1 },
        { buildingId: 'hearthfire', count: 1 },
      ],
      // (0,0)'s fire at radius 1 reaches (0,0), (1,0) and (0,1) on the map;
      // its other neighbours are off it.
      lit: 3,
      befriended: 4,
      species: 2,
      villages: null,
    });
    // A paused homestead is still a homestead; an unlit fire lights nothing.
    expect(of(B)).toMatchObject({ tiles: 3, homesteads: 1, lit: 0 });
    expect(of(C)).toMatchObject({
      lit: 1,
      befriended: 0,
      species: 0,
      buildings: [{ buildingId: 'hearthfire', count: 1 }],
    });
  });

  it('crowns whoever leads each category, shares a tie, and never crowns a 0', () => {
    expect(of(A)?.crowns).toEqual(['befriended', 'builder', 'brightest']);
    expect(of(B)?.crowns).toEqual(['land', 'befriended', 'collector']);
    expect(of(C)?.crowns).toEqual([]);
  });

  it('crowns nobody on a fresh patch', () => {
    const fresh = patchStats(view([tile(0, 0)], members), new Map());
    expect(fresh.keepers.every((k) => k.crowns.length === 0)).toBe(true);
  });
});
