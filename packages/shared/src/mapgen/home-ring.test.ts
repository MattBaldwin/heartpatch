import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { hexKey } from '../hex/index.js';
import { generateMap } from './index.js';
import { missingHomeRingNodes, type HomeRingTile } from './home-ring.js';

const OLD_RING = ['timber', 'stone', 'emberwood', 'treats'];
const { homeRingNodes } = GAME_DATA.mapGen;

/** A stored map's home tiles, as a map made before the seasonal nodes has them. */
function oldHomes(seed: string): HomeRingTile[] {
  const map = generateMap(
    { ...GAME_DATA, mapGen: { ...GAME_DATA.mapGen, homeRingNodes: OLD_RING } },
    { seed, playerCount: 4 },
  );
  return map.tiles.flatMap((t) =>
    t.homeSlot === null
      ? []
      : [{ q: t.q, r: t.r, homeSlot: t.homeSlot, nodeResource: t.nodeResource, takenSpots: [] }],
  );
}

const slot0 = () => oldHomes('older-map').filter((t) => t.homeSlot === 0);

describe('missingHomeRingNodes', () => {
  it('adds nothing to a map generated with every home-ring node', () => {
    const map = generateMap(GAME_DATA, { seed: 'fresh', playerCount: 4 });
    const homes = map.tiles.flatMap((t) =>
      t.homeSlot === null ? [] : [{ ...t, homeSlot: t.homeSlot, takenSpots: [] }],
    );
    expect(missingHomeRingNodes(homes, homeRingNodes, 'fresh')).toEqual({ add: [], waiting: 0 });
  });

  it('tops up every home of an older map with Pumpkins and a leaf pile on free ring tiles', () => {
    const homes = oldHomes('older-map');
    const { add, waiting } = missingHomeRingNodes(homes, homeRingNodes, 'older-map');
    const byKey = new Map(homes.map((t) => [hexKey(t), t]));
    expect(add).toHaveLength(8);
    expect(waiting).toBe(0);
    for (const slot of [0, 1, 2, 3]) {
      const mine = add.filter((n) => byKey.get(hexKey(n))?.homeSlot === slot);
      expect(mine.map((n) => n.resource)).toEqual(['pumpkins', 'magic-fallen-leaves']);
      for (const node of mine) {
        expect(byKey.get(hexKey(node))?.nodeResource).toBeNull();
        expect(node.moveMiddleTo).toBeNull();
      }
    }
    // The Heart Seed tile (the middle of the seven) never gets a node.
    const map = generateMap(GAME_DATA, { seed: 'older-map', playerCount: 4 });
    const seeds = new Set(map.homes.map(hexKey));
    for (const node of add) expect(seeds.has(hexKey(node))).toBe(false);
  });

  it('picks the same tiles every time, turned by the map seed', () => {
    const homes = oldHomes('older-map');
    const once = missingHomeRingNodes(homes, homeRingNodes, 'older-map');
    expect(missingHomeRingNodes([...homes].reverse(), homeRingNodes, 'older-map')).toEqual(once);
    // Hand-authored maps have no seed: ring order, still the same every time.
    expect(missingHomeRingNodes(homes, homeRingNodes, null)).toEqual(
      missingHomeRingNodes(homes, homeRingNodes, null),
    );
  });

  it('prefers a ring tile with a free middle over moving a building', () => {
    const homes = slot0();
    const first = missingHomeRingNodes(homes, homeRingNodes, 'older-map').add;
    const built = homes.map((t) =>
      t.q === first[0]!.q && t.r === first[0]!.r ? { ...t, takenSpots: [0] } : t,
    );
    // Pumpkins take the other bare tile; the leaf pile moves the building aside.
    expect(missingHomeRingNodes(built, homeRingNodes, 'older-map').add).toEqual([
      { q: first[1]!.q, r: first[1]!.r, resource: 'pumpkins', moveMiddleTo: null },
      { q: first[0]!.q, r: first[0]!.r, resource: 'magic-fallen-leaves', moveMiddleTo: 1 },
    ]);
  });

  it('moves a building in the middle to the lowest free side spot on its own tile (a full ring)', () => {
    const homes = slot0();
    const bare = missingHomeRingNodes(homes, homeRingNodes, 'older-map').add;
    const crowded = homes.map((t) => {
      if (t.q === bare[0]!.q && t.r === bare[0]!.r) return { ...t, takenSpots: [0, 1, 2] };
      if (t.q === bare[1]!.q && t.r === bare[1]!.r) return { ...t, takenSpots: [0, 3] };
      return t;
    });
    expect(missingHomeRingNodes(crowded, homeRingNodes, 'older-map')).toEqual({
      add: [
        { q: bare[0]!.q, r: bare[0]!.r, resource: 'pumpkins', moveMiddleTo: 3 },
        { q: bare[1]!.q, r: bare[1]!.r, resource: 'magic-fallen-leaves', moveMiddleTo: 1 },
      ],
      waiting: 0,
    });
  });

  it('waits only when every bare ring tile is full of buildings', () => {
    const homes = slot0().map((t) =>
      t.nodeResource === null ? { ...t, takenSpots: [0, 1, 2, 3, 4, 5, 6] } : t,
    );
    expect(missingHomeRingNodes(homes, homeRingNodes, 'older-map')).toEqual({
      add: [],
      waiting: 2,
    });
  });
});
