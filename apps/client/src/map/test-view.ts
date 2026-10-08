import {
  defaultKeeperConfig,
  hexDistance,
  hexKey,
  hexNeighbors,
  GAME_DATA,
  KEEPER_BASES,
  MAP_MAX_PLAYERS,
  generateMap,
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

/**
 * A busy 4-Keeper patch (#278): `testView(4)` with each Keeper's land grown
 * out from their home, nearest tiles first, `extra` tiles each, so rivals'
 * land meets and neutral land lies between. Juniper's Gap stays neutral. The
 * same land every run.
 */
export function testPatch(extra = 48): MapView {
  const view = testView(4);
  const tiles = view.tiles.map((t) => ({ ...t }));
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const seeds = view.members.map(
    (m) =>
      tiles.find(
        (t) =>
          t.homeSlot === m.homeSlot &&
          hexNeighbors(t).every((n) => byKey.get(hexKey(n))?.homeSlot === m.homeSlot),
      ) ?? tiles[0],
  );
  const left = view.members.map(() => extra);
  for (let round = 0; round < extra; round++) {
    view.members.forEach((m, i) => {
      const seed = seeds[i];
      if (!seed || (left[i] ?? 0) <= 0) return;
      let best: PublicTile | null = null;
      for (const t of tiles) {
        if (t.ownerUserId !== null || t.homeSlot !== null || t.terrain === 'junipers-gap') continue;
        if (!hexNeighbors(t).some((n) => byKey.get(hexKey(n))?.ownerUserId === m.user.id)) continue;
        const score = (x: PublicTile) => hexDistance(x, seed) * 100 + x.q * 3 + x.r;
        if (!best || score(t) < score(best)) best = t;
      }
      if (!best) return;
      best.ownerUserId = m.user.id;
      left[i] = (left[i] ?? 0) - 1;
    });
  }
  return { ...view, tiles };
}
