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
      : [
          {
            q: t.q,
            r: t.r,
            homeSlot: t.homeSlot,
            nodeResource: t.nodeResource,
            middleTaken: false,
          },
        ],
  );
}

describe('missingHomeRingNodes', () => {
  it('adds nothing to a map generated with every home-ring node', () => {
    const map = generateMap(GAME_DATA, { seed: 'fresh', playerCount: 4 });
    const homes = map.tiles.flatMap((t) =>
      t.homeSlot === null ? [] : [{ ...t, homeSlot: t.homeSlot, middleTaken: false }],
    );
    expect(missingHomeRingNodes(homes, homeRingNodes, 'fresh')).toEqual([]);
  });

  it('tops up every home of an older map with Pumpkins and a leaf pile on free ring tiles', () => {
    const homes = oldHomes('older-map');
    const added = missingHomeRingNodes(homes, homeRingNodes, 'older-map');
    const byKey = new Map(homes.map((t) => [hexKey(t), t]));
    expect(added).toHaveLength(8);
    for (const slot of [0, 1, 2, 3]) {
      const mine = added.filter((n) => byKey.get(hexKey(n))?.homeSlot === slot);
      expect(mine.map((n) => n.resource)).toEqual(['pumpkins', 'magic-fallen-leaves']);
      for (const node of mine) expect(byKey.get(hexKey(node))?.nodeResource).toBeNull();
    }
    // The Heart Seed tile (the middle of the seven) never gets a node.
    const map = generateMap(GAME_DATA, { seed: 'older-map', playerCount: 4 });
    const seeds = new Set(map.homes.map(hexKey));
    for (const node of added) expect(seeds.has(hexKey(node))).toBe(false);
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

  it('skips a ring tile with a building in its middle, and waits when none is free', () => {
    const homes = oldHomes('older-map').filter((t) => t.homeSlot === 0);
    const first = missingHomeRingNodes(homes, homeRingNodes, 'older-map');
    const built = homes.map((t) =>
      t.q === first[0]!.q && t.r === first[0]!.r ? { ...t, middleTaken: true } : t,
    );
    const second = missingHomeRingNodes(built, homeRingNodes, 'older-map');
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ resource: 'pumpkins' });
    expect(hexKey(second[0]!)).not.toBe(hexKey(first[0]!));
    const full = homes.map((t) => (t.nodeResource === null ? { ...t, middleTaken: true } : t));
    expect(missingHomeRingNodes(full, homeRingNodes, 'older-map')).toEqual([]);
  });
});
