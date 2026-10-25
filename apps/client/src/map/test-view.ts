import {
  communityReach,
  defaultKeeperConfig,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  hexRing,
  GAME_DATA,
  KEEPER_BASES,
  generateMap,
  tradingPostLabels,
  type CommunityView,
  type MapMember,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { isWaterTile } from './map-dressing.js';

// A realistic map view for unit tests: a real generated 4-player map, as the
// server would send it, with members taking home slots in order. Pinned to
// 4 seats (older patches keep 4, #318); 6-seat views are made on purpose.

/** Seats on the test map. */
const SEATS = 4;

export const MAP_ID = '0190a8c4-0000-7000-8000-00000000000a';

export function userId(n: number): string {
  return `0190a8c4-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

/** The test map's `n`th Hollowed village's id (#306). */
export function communityId(n: number): string {
  return `0190a8c4-0000-7000-8000-c${String(n).padStart(11, '0')}`;
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
export function testView(players = 1, seed = 'map-render-test', seats = SEATS): MapView {
  const generated = generateMap(GAME_DATA, { seed, playerCount: seats });
  const members = Array.from({ length: players }, (_, i) => member(i + 1, i));
  // Trading posts (#269) named as the server names them.
  const posts = tradingPostLabels(generated.tiles, GAME_DATA.mapGen.tradingPosts);
  // Hollowed villages (#306) as the server marks them: nothing restored yet.
  // (Never the cellar key: the server keeps it.)
  const villageOf = new Map<string, string>();
  generated.communities.forEach((c, i) => {
    for (const t of c.tiles) villageOf.set(hexKey(t), communityId(i + 1));
  });
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
      communityId: villageOf.get(hexKey(t)) ?? null,
    }))
    .sort((a, b) => a.q - b.q || a.r - b.r);
  // Reach as keeper1 sees it (the shared rule the server uses).
  const communities: CommunityView[] = generated.communities.map((c, i) => ({
    id: communityId(i + 1),
    name: c.name,
    kind: c.kind,
    square: { q: c.square.q, r: c.square.r },
    tiles: c.tiles.map((t) => ({ q: t.q, r: t.r })),
    restored: 0,
    ownerUserId: null,
    ...(players > 0 ? communityReach(c.tiles, tiles, userId(1)) : { reach: null, distance: null }),
  }));
  return {
    map: {
      id: MAP_ID,
      name: 'Pumpkin Hollow',
      timeZone: 'America/New_York',
      pvpMode: 'gentle',
      maxPlayers: seats,
    },
    members,
    tiles,
    communities,
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
  return grown(testView(4), extra, (t) => t.terrain !== 'junipers-gap');
}

/**
 * Each Keeper's land grown out from their home, nearest tiles first, `extra`
 * tiles each, onto tiles `claimable` allows (and never a home ring).
 */
function grown(view: MapView, extra: number, claimable: (t: PublicTile) => boolean): MapView {
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
        if (t.ownerUserId !== null || t.homeSlot !== null || !claimable(t)) continue;
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

/** The Wild Isle test map's radius (#621 revision 1: rings 17–18 ocean, 16 coast). */
export const WILD_RADIUS = 18;

/**
 * A hand-made radius-18 Wild Isle (#621 W1-4) for the map's looks, budgets
 * and captures, until W1-2's generator can make one: the 6-seat Cozy test map
 * (radius 16) as its land, with ring 16 turned to coast, rings 17–18 added as
 * ocean, Cozy lakes made `wild-lake`, three rivers running from the middle out
 * between the homes to the sea (one through a pond), and two little isles out
 * in the ocean. Each Keeper's land is grown `extra` tiles, never onto water.
 * The same map every run.
 */
export function testWildIsle(players = 6, extra = 30): MapView {
  const base = testView(players, 'map-render-test', 6);
  const origin = { q: 0, r: 0 };
  const byKey = new Map(base.tiles.map((t) => [hexKey(t), { ...t }]));
  const water = (t: PublicTile, terrain: string) => {
    t.terrain = terrain;
    t.nodeResource = null;
  };
  // The coast rings the land; Cozy's lakes are Wild Isle's water lakes.
  for (const t of byKey.values()) {
    if (hexDistance(t, origin) === WILD_RADIUS - 2 && t.post === null) water(t, 'coast');
    else if (t.terrain === 'lake') water(t, t.homeSlot === null ? 'wild-lake' : 'meadow');
  }
  // Rivers: from near the middle out to the coast, between neighbouring homes,
  // with one bend. Never through a home, the Gap, a post or a village.
  const blocked = (t: PublicTile | undefined) =>
    !t ||
    t.homeSlot !== null ||
    t.terrain === 'junipers-gap' ||
    t.post !== null ||
    t.communityId !== null;
  const homes = Array.from({ length: 6 }, (_, slot) => {
    const ring = base.tiles.filter((t) => t.homeSlot === slot);
    const q = ring.reduce((n, t) => n + t.q, 0) / ring.length;
    const r = ring.reduce((n, t) => n + t.r, 0) / ring.length;
    return { q, r };
  });
  const toward = (a: { q: number; r: number }, scale: number) => {
    const len = hexDistance({ q: Math.round(a.q), r: Math.round(a.r) }, origin) || 1;
    return { q: Math.round((a.q * scale) / len), r: Math.round((a.r * scale) / len) };
  };
  const rivers: PublicTile[][] = [];
  for (let i = 0; i < homes.length && rivers.length < 3; i++) {
    const a = homes[i];
    const b = homes[(i + 1) % homes.length];
    if (!a || !b) continue;
    const between = { q: (a.q + b.q) / 2, r: (a.r + b.r) / 2 };
    const source = toward(between, 4);
    const bend = toward(
      { q: between.q + (a.q - b.q) * 0.15, r: between.r + (a.r - b.r) * 0.15 },
      10,
    );
    const mouth = toward(between, WILD_RADIUS - 2);
    const path = [...hexLine(source, bend), ...hexLine(bend, mouth).slice(1)].map((h) =>
      byKey.get(hexKey(h)),
    );
    if (path.some(blocked)) continue;
    rivers.push(path.filter((t): t is PublicTile => t !== undefined));
  }
  for (const path of rivers) for (const t of path) water(t, 'river');
  // A pond part way down the first river.
  const first = rivers.at(0);
  const pond = first ? first[Math.floor(first.length * 0.4)] : undefined;
  if (pond) {
    for (const h of hexNeighbors(pond)) {
      const t = byKey.get(hexKey(h));
      if (t && !blocked(t) && t.terrain !== 'river') water(t, 'wild-lake');
    }
    water(pond, 'wild-lake');
  }
  // The ocean, and two isles of four tiles each out on the last ring.
  const outer = hexRing(origin, WILD_RADIUS);
  const isles = new Map<string, string>();
  for (const start of [WILD_RADIUS + 5, WILD_RADIUS * 4 + 9]) {
    ['coast', 'meadow', 'forest', 'coast'].forEach((terrain, i) => {
      const h = outer[(start + i) % outer.length];
      if (h) isles.set(hexKey(h), terrain);
    });
  }
  for (let ring = WILD_RADIUS - 1; ring <= WILD_RADIUS; ring++) {
    for (const h of hexRing(origin, ring)) {
      byKey.set(hexKey(h), {
        q: h.q,
        r: h.r,
        terrain: isles.get(hexKey(h)) ?? 'ocean',
        ownerUserId: null,
        nodeResource: null,
        homeSlot: null,
        gathering: null,
        cooldownUntil: null,
        defenders: 0,
        guardianHint: null,
        buildings: [],
        post: null,
        communityId: null,
      });
    }
  }
  const tiles = [...byKey.values()].sort((a, b) => a.q - b.q || a.r - b.r);
  const view: MapView = {
    ...base,
    map: { ...base.map, name: 'Wild Isle', patchType: 'wild-isle' },
    tiles,
  };
  return grown(view, extra, (t) => t.terrain !== 'junipers-gap' && !isWaterTile(t));
}
