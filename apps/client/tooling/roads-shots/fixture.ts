/// <reference types="node" />
import {
  ferryShore,
  GAME_DATA,
  travelBuildCheck,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  isWaterTerrain,
  supplyMap,
  TRAVEL_RULES,
  type Hex,
  type MapView,
  type PublicBuilding,
  type PublicRoad,
  type PublicTile,
} from '@heartpatch/shared';
import { testWildIsle } from '../../src/map/test-view.js';

// The ONE game state every roads shot draws (#621 W1-6): `testWildIsle()` with
// the signed-in player as Keeper 1, a 3-level road network, a bridge on a
// river, a ferry dock on a lake and two tiles cut off from home. Printed as
// JSON for shoot.mjs, which serves it for the view, roads and tending routes.
// Run: `tsx --conditions=@heartpatch/source fixture.ts '<{"me":…,"map":…}>'`.

interface Input {
  /** The real signed-in member (keeper 1's seat is theirs) and the real map's id. */
  member: MapView['members'][number];
  mapId: string;
  seq: number;
}

const input = JSON.parse(process.argv[2] ?? '{}') as Input;
const base = testWildIsle();
const fixtureMember = base.members[0];
if (!fixtureMember) throw new Error('no member 1');
const fixtureMe = fixtureMember.user.id;
const me = input.member.user.id;

const view: MapView = {
  ...base,
  map: { ...base.map, id: input.mapId },
  members: [input.member, ...base.members.slice(1)],
  tiles: base.tiles.map((t) => ({
    ...t,
    ownerUserId: t.ownerUserId === fixtureMe ? me : t.ownerUserId,
    buildings: [...t.buildings],
  })),
  seq: input.seq,
};
const byKey = new Map<string, PublicTile>(view.tiles.map((t) => [hexKey(t), t]));
const tileAt = (h: Hex) => byKey.get(hexKey(h));
const isLand = (t: PublicTile | undefined): t is PublicTile =>
  t !== undefined && !isWaterTerrain(t.terrain) && t.terrain !== 'trading-post';
const plain = (t: PublicTile | undefined): t is PublicTile =>
  isLand(t) && t.communityId === null && t.homeSlot === null && t.post === null;
const claim = (h: Hex) => {
  const t = tileAt(h);
  if (plain(t) && t.ownerUserId === null) t.ownerUserId = me;
};
const home = view.tiles.filter((t) => t.homeSlot === 0);
const homeCentre = home.find((t) => hexNeighbors(t).every((n) => tileAt(n)?.homeSlot === 0));
if (!homeCentre) throw new Error('no home centre');
const dist = (a: Hex, b: Hex) => hexDistance(a, b);

/** Closest hex of `from` to `to`. */
const nearest = <T extends Hex>(from: readonly T[], to: Hex): T => {
  const first = [...from].sort((a, b) => dist(a, to) - dist(b, to) || a.q - b.q || a.r - b.r)[0];
  if (!first) throw new Error('nothing to pick from');
  return first;
};

// --- The dock: my land beside the wild lake nearest home. ---
const lakes = view.tiles.filter((t) => t.terrain === 'wild-lake');
const lakeNear = nearest(lakes, homeCentre);
// A dry, ownable tile touching that lake, nearest home; the line to it is mine.
const dockSpot = nearest(
  hexNeighbors(lakeNear)
    .map(tileAt)
    .filter((t): t is PublicTile => plain(t) && (t.ownerUserId === null || t.ownerUserId === me)),
  homeCentre,
);
for (const h of hexLine(homeCentre, dockSpot)) claim(h);
claim(dockSpot);
const building = (buildingId: string, n: number): PublicBuilding => ({
  id: `0190a8c4-0000-7000-8000-d${String(n).padStart(11, '0')}`,
  buildingId,
  kind: 'travel',
  level: 1,
  spot: 1,
  lit: null,
  safeRadius: null,
});
dockSpot.buildings.push(building('ferry-dock', 1));

// --- The bridge: a river tile beside my land, with land of mine across it. ---
const rivers = view.tiles.filter((t) => t.terrain === 'river');
const mineNow = () => view.tiles.filter((t) => t.ownerUserId === me && isLand(t));
let bridgeSpot: PublicTile | null = null;
let nearBank: PublicTile | null = null;
let farBank: PublicTile | null = null;
for (const river of [...rivers].sort((a, b) => dist(a, homeCentre) - dist(b, homeCentre))) {
  const banks = hexNeighbors(river)
    .map(tileAt)
    .filter((t): t is PublicTile => plain(t) && t.communityId === null);
  // Two banks on opposite sides: the farthest-apart pair.
  let best: [PublicTile, PublicTile] | null = null;
  for (const a of banks)
    for (const b of banks)
      if (dist(a, b) === 2 && (!best || dist(a, homeCentre) < dist(best[0], homeCentre)))
        best = [a, b];
  if (!best) continue;
  const [a, b] = dist(best[0], homeCentre) <= dist(best[1], homeCentre) ? best : [best[1], best[0]];
  if (dist(a, homeCentre) > 6 || dist(b, homeCentre) > 9) continue;
  // The far bank must not already be reached by the dock or by walking.
  bridgeSpot = river;
  nearBank = a;
  farBank = b;
  break;
}
if (!bridgeSpot || !nearBank || !farBank) throw new Error('no river bank pair near home');
for (const h of hexLine(homeCentre, nearBank)) claim(h);
claim(nearBank);
claim(farBank);
for (const n of hexNeighbors(farBank)) if (dist(n, bridgeSpot) === 2) claim(n);
bridgeSpot.buildings.push(building('bridge', 2));

// --- Roads: a 3-level network from home toward the bridge, with a branch. ---
const roads: PublicRoad[] = [];
const road = (h: Hex, level: 1 | 2 | 3) => {
  const t = tileAt(h);
  if (t?.ownerUserId === me && isLand(t) && !roads.some((r) => r.q === h.q && r.r === h.r)) {
    roads.push({ q: h.q, r: h.r, ownerUserId: me, level });
  }
};
const trunk = hexLine(homeCentre, nearBank);
trunk.forEach((h, i) => {
  road(h, i < trunk.length / 3 ? 3 : i < (2 * trunk.length) / 3 ? 2 : 1);
});
// Across the bridge, and a spur out to the dock.
road(farBank, 1);
hexLine(homeCentre, dockSpot).forEach((h, i, line) => {
  road(h, i < line.length - 1 ? 2 : 1);
});
// A short level-3 loop round home so all three levels meet in one frame.
for (const n of hexNeighbors(homeCentre).slice(0, 2)) road(n, 3);

// --- Two tiles cut off from home, far from every road, bridge and dock. ---
const bridgeAt = bridgeSpot;
const supplied = () =>
  supplyMap(view.tiles, roads, [{ ...bridgeAt, ownerUserId: '' }], me, TRAVEL_RULES, [
    { ...dockSpot, ownerUserId: me },
  ]);
const shore = ferryShore(view.tiles, dockSpot, TRAVEL_RULES.ferry.range);
const reached = supplied();
const farFromAll = (t: PublicTile) =>
  dist(t, homeCentre) >= 9 &&
  !shore.has(hexKey(t)) &&
  !reached.reach.has(hexKey(t)) &&
  hexNeighbors(t).every((n) => tileAt(n)?.ownerUserId !== me);
const stranded = nearest(
  view.tiles.filter(
    (t) =>
      plain(t) &&
      t.ownerUserId === null &&
      farFromAll(t) &&
      hexNeighbors(t).filter((n) => plain(tileAt(n))).length === 6 &&
      hexNeighbors(t).every((n) => !shore.has(hexKey(n))),
  ),
  { q: homeCentre.q + 7, r: homeCentre.r - 7 },
);
const strandedPair = [
  stranded,
  nearest(hexNeighbors(stranded).map(tileAt).filter(plain), stranded),
];
for (const t of strandedPair) t.ownerUserId = me;

const final = supplied();
for (const t of strandedPair) {
  if (final.supplied.has(hexKey(t))) throw new Error('stranded tile is supplied');
}
// --- A river tile no bridge can start from: no neighbour is joined to home ("too far"). ---
const bridgeBuilding = GAME_DATA.buildings.find((b) => b.id === 'bridge');
if (!bridgeBuilding || bridgeBuilding.kind !== 'travel') throw new Error('no bridge building');
const cantBuild = nearest(
  rivers.filter((t) => {
    if (t === bridgeAt || t.buildings.length > 0) return false;
    const check = travelBuildCheck({
      building: bridgeBuilding,
      patchType: view.map.patchType ?? 'cozy',
      userId: me,
      tile: {
        q: t.q,
        r: t.r,
        terrain: t.terrain,
        ownerUserId: t.ownerUserId,
        communityId: t.communityId ?? null,
        hasBuilding: false,
      },
      tiles: view.tiles,
      supplied: final.supplied,
      ownDocks: [],
    });
    return !check.ok && check.reason === 'too-far';
  }),
  homeCentre,
);
const now = Date.now();
const hours = (h: number) => new Date(now + h * 3_600_000).toISOString();
const tending = {
  missing: [],
  wentWild: [],
  stranded: strandedPair.map((t) => ({ q: t.q, r: t.r, since: hours(-3), wildAt: hours(33) })),
  nextMissesYouAt: null,
  now: new Date(now).toISOString(),
};
const farShore = [...shore.keys()]
  .map((k) => byKey.get(k))
  .filter((t): t is PublicTile => t !== undefined && !final.supplied.has(hexKey(t)));

process.stdout.write(
  JSON.stringify({
    view,
    roads: { roads },
    tending: { tending },
    spots: {
      home: homeCentre,
      network: trunk[Math.floor(trunk.length / 2)] ?? homeCentre,
      pathTile: nearest(
        mineNow().filter(
          (t) => t.homeSlot === null && !roads.some((r) => r.q === t.q && r.r === t.r),
        ),
        homeCentre,
      ),
      bridge: bridgeSpot,
      cantBuild,
      /** The middle of the road from home to the bridge's near bank, whole network in frame. */
      networkMid: trunk[Math.floor((trunk.length - 1) * 0.3)] ?? homeCentre,
      bridgeNearBank: nearBank,
      dock: dockSpot,
      farShore: nearest(farShore, dockSpot),
      stranded: strandedPair[0],
    },
    counts: {
      roadsByLevel: [1, 2, 3].map((l) => roads.filter((r) => r.level === l).length),
      farShore: farShore.length,
      supplied: final.supplied.size,
    },
  }),
);
