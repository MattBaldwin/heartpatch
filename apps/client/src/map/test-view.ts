import {
  defaultKeeperConfig,
  GAME_DATA,
  KEEPER_BASES,
  MAP_MAX_PLAYERS,
  generateMap,
  tradingPostLabels,
  type MapMember,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';

// A realistic map view for unit tests: a real generated 4-player map, as the
// server would send it, with members taking home slots in order.

export const MAP_ID = '0190a8c4-0000-7000-8000-00000000000a';

export function userId(n: number): string {
  return `0190a8c4-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

export function member(n: number, homeSlot: number): MapMember {
  const base = KEEPER_BASES[(n - 1) % KEEPER_BASES.length];
  return {
    user: { id: userId(n), username: `keeper${String(n)}` },
    role: n === 1 ? 'owner' : 'member',
    homeSlot,
    joinedAt: '2026-10-02T12:00:00.000Z',
    keeper: base ? { ...defaultKeeperConfig(base), wearing: [] } : null,
    title: null,
  };
}

/** A view with `players` members; each owns their home ring, as the server sets it. */
export function testView(players = 1, seed = 'map-render-test'): MapView {
  const generated = generateMap(GAME_DATA, { seed, playerCount: MAP_MAX_PLAYERS });
  const members = Array.from({ length: players }, (_, i) => member(i + 1, i));
  // Trading posts (#269) named as the server names them.
  const posts = tradingPostLabels(generated.tiles, GAME_DATA.mapGen.tradingPosts);
  const tiles: PublicTile[] = generated.tiles
    .map((t) => ({
      q: t.q,
      r: t.r,
      terrain: t.terrain,
      ownerUserId: t.homeSlot !== null && t.homeSlot < players ? userId(t.homeSlot + 1) : null,
      nodeResource: t.nodeResource,
      homeSlot: t.homeSlot,
      gathering: null,
      cooldownUntil: null,
      defenders: 0,
      guardianHint: null,
      buildings: [],
      post: posts.get(`${String(t.q)},${String(t.r)}`) ?? null,
    }))
    .sort((a, b) => a.q - b.q || a.r - b.r);
  return {
    map: {
      id: MAP_ID,
      name: 'Pumpkin Hollow',
      timeZone: 'America/New_York',
      pvpMode: 'gentle',
      maxPlayers: MAP_MAX_PLAYERS,
    },
    members,
    tiles,
    seq: players,
  };
}
