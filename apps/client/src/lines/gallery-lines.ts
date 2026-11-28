import {
  hexDistance,
  hexKey,
  hexNeighbors,
  isWaterTerrain,
  type HexKey,
  type MapView,
  type PublicLine,
  type PublicRoad,
  type PublicTile,
} from '@heartpatch/shared';

// Sample wires and rails for the dev island gallery and the render budget
// (#874 C4): on each of the first `keepers` Keepers' land, a wire chain out
// from their home (the first half carrying power, the rest dark, as M2's
// lit and unlit chains) and a rail chain beside it (Rail, then Tidy rail).
// The same lines every run for the same map. Dev and tests only.

/** A chain of `length` of `owner`'s land tiles, each next to the last, out from `from`; never a home tile or `used`. */
function chain(
  tiles: ReadonlyMap<HexKey, PublicTile>,
  owner: string,
  from: PublicTile,
  length: number,
  used: Set<HexKey>,
): PublicTile[] {
  const ok = (t: PublicTile | undefined): t is PublicTile =>
    t !== undefined &&
    t.ownerUserId === owner &&
    t.homeSlot === null &&
    !isWaterTerrain(t.terrain) &&
    !used.has(hexKey(t));
  const start = [...tiles.values()]
    .filter(ok)
    .sort((a, b) => hexDistance(a, from) - hexDistance(b, from) || a.q - b.q || a.r - b.r)[0];
  if (!start) return [];
  const out = [start];
  used.add(hexKey(start));
  while (out.length < length) {
    const last = out[out.length - 1];
    if (!last) break;
    // Step outwards: the free neighbour farthest from home.
    const next = hexNeighbors(last)
      .map((h) => tiles.get(hexKey(h)))
      .filter(ok)
      .sort((a, b) => hexDistance(b, from) - hexDistance(a, from) || a.q - b.q || a.r - b.r)[0];
    if (!next) break;
    used.add(hexKey(next));
    out.push(next);
  }
  return out;
}

/** Sample lines on a view's land: a wire chain and a rail chain per Keeper. */
export function galleryLines(view: MapView, keepers = 6, length = 6): PublicLine[] {
  const tiles = new Map(view.tiles.map((t) => [hexKey(t), t]));
  const lines: PublicLine[] = [];
  const used = new Set<HexKey>();
  for (const member of view.members.slice(0, keepers)) {
    const owner = member.user.id;
    const home = view.tiles.find((t) => t.homeSlot === member.homeSlot && t.ownerUserId === owner);
    if (!home) continue;
    chain(tiles, owner, home, length, used).forEach((t, i) => {
      lines.push({
        q: t.q,
        r: t.r,
        kind: 'wire',
        ownerUserId: owner,
        level: 1,
        powered: i < length / 2,
      });
    });
    chain(tiles, owner, home, length - 1, used).forEach((t, i) => {
      lines.push({ q: t.q, r: t.r, kind: 'rail', ownerUserId: owner, level: i < 2 ? 2 : 1 });
    });
  }
  return lines;
}

/**
 * Sample roads for the gallery (#874): every Keeper's building tile and the
 * land tiles beside it, so a Clockwork Isle's loops round buildings show
 * joined up. Dev and tests only.
 */
export function galleryRoads(view: MapView): PublicRoad[] {
  const tiles = new Map(view.tiles.map((t) => [hexKey(t), t]));
  const roads = new Map<HexKey, PublicRoad>();
  for (const tile of view.tiles) {
    const owner = tile.ownerUserId;
    if (!owner || tile.buildings.length === 0) continue;
    for (const h of [tile, ...hexNeighbors(tile)]) {
      const t = tiles.get(hexKey(h));
      if (!t || t.ownerUserId !== owner || isWaterTerrain(t.terrain)) continue;
      const near = t.buildings.length > 0 || hexKey(t) === hexKey(tile);
      if (near || roads.size % 3 === 0) {
        roads.set(hexKey(t), { q: t.q, r: t.r, ownerUserId: owner, level: 2 });
      }
    }
  }
  return [...roads.values()];
}
