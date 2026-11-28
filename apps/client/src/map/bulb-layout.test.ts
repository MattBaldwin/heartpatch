import {
  BUILDINGS,
  hex,
  hexToWorld,
  HOME_BASE_RULES,
  isBuildable,
  MAP_MAX_PLAYERS,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  bulbCounts,
  bulbLayout,
  edgeCovered,
  litTiles,
  tileBulbs,
  type BulbTile,
} from './bulb-layout.js';
import { FENCE_INSET } from './fence-layout.js';
import { CHRISTMAS } from './map-config.js';
import { testView } from './test-view.js';

const SIZE = 0.65;
const B = CHRISTMAS.bulbs;
const FULL = { perEdge: B.perEdge, perEave: B.perEave, perPost: B.perPost };

const tile = (q: number, r: number, over: Partial<BulbTile> = {}): BulbTile => ({
  ...hex(q, r),
  rim: 0.3,
  fenced: new Set(),
  eaves: [],
  posts: [],
  ...over,
});

describe('Twinkle Lights data (#37 2a)', () => {
  const twinkle = BUILDINGS.find((b) => b.id === 'twinkle-lights');

  it("is kind 'lights', the kind X2's Christmas Eve head start counts", () => {
    // `apps/server/src/modules/boss/repo.ts` counts `buildings.kind = 'lights'`.
    expect(twinkle?.kind).toBe('lights');
    expect(twinkle && isBuildable(HOME_BASE_RULES, twinkle)).toBe(true);
  });

  it('caps a full patch under the bulb cap, every string still lit', () => {
    if (!twinkle?.maxPerHome) throw new Error('Twinkle Lights need maxPerHome');
    // A Keeper's cap counts at home and across the patch apart, so up to
    // twice it can stand; on home tiles two can share one, counted once.
    const worst = MAP_MAX_PLAYERS * twinkle.maxPerHome * 2;
    const heavy: BulbEave[] = Array.from({ length: 6 }, () => ({
      x: 0,
      z: 0,
      y: 0.5,
      radius: 0.1,
      footprint: 0.1,
    }));
    const tiles = Array.from({ length: worst }, (_, i) =>
      tile(3 * i, 0, { eaves: heavy, posts: [{ x: 0, z: 0, y: 0.3, height: 0.3, radius: 0.04 }] }),
    );
    const bulbs = bulbLayout(tiles, SIZE);
    expect(bulbs.length).toBeLessThanOrEqual(B.cap);
    const share = bulbCounts(6, 1, Math.floor(B.cap / worst));
    // Every edge of every tile keeps a string (at least three bulbs).
    expect(share.perEdge).toBeGreaterThanOrEqual(3);
    expect(bulbs.length).toBe(worst * tileBulbs(tiles[0]!, SIZE, share).length);
  });
});

type BulbEave = BulbTile['eaves'][number];

describe('bulb layout (#37 2a)', () => {
  it('strings each of the six edges between its corners, on the rim, corners free', () => {
    const t = tile(2, -1);
    const bulbs = tileBulbs(t, SIZE, { perEdge: 5, perEave: 0, perPost: 0 });
    expect(bulbs).toHaveLength(30);
    const c = hexToWorld(t, SIZE);
    const apothem = SIZE * FENCE_INSET * (Math.sqrt(3) / 2);
    for (const b of bulbs) {
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      // Between the edge's middle (the apothem) and its corner, never past it.
      expect(d).toBeGreaterThanOrEqual(apothem - 1e-6);
      expect(d).toBeLessThan(SIZE * FENCE_INSET - 0.02);
      expect(b.y).toBeGreaterThan(t.rim);
      expect(b.y).toBeLessThanOrEqual(t.rim + B.rimLift);
    }
    // Spread round the tile: every 60° sector holds five.
    const sectors = new Map<number, number>();
    for (const b of bulbs) {
      const a = (Math.atan2(b.z - c.z, b.x - c.x) * 180) / Math.PI;
      const s = Math.round((((a % 360) + 360) % 360) / 60) % 6;
      sectors.set(s, (sectors.get(s) ?? 0) + 1);
    }
    expect([...sectors.values()]).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it('rides on top of a fence where the edge has one', () => {
    const t = tile(0, 0, { fenced: new Set([1]) });
    const bulbs = tileBulbs(t, SIZE, { perEdge: 5, perEave: 0, perPost: 0 });
    const edge1 = bulbs.slice(5, 10);
    const edge0 = bulbs.slice(0, 5);
    for (const b of edge1) expect(b.y).toBeGreaterThan(t.rim + B.fenceLift - B.sag - 1e-6);
    for (const b of edge0) expect(b.y).toBeLessThan(t.rim + B.fenceLift - B.sag);
  });

  it('hangs a swag under each building’s eaves on the camera side, and coils the post', () => {
    const eave = { x: 1, z: 2, y: 0.8, radius: 0.2, footprint: 0.2 };
    const post = { x: -1, z: 0.5, y: 0.3, height: 0.4, radius: 0.05 };
    const t = tile(0, 0, { eaves: [eave], posts: [post] });
    const bulbs = tileBulbs(t, SIZE, FULL);
    expect(bulbs).toHaveLength(6 * B.perEdge + B.perPost + B.perEave);
    const swag = bulbs.slice(-B.perEave);
    for (const b of swag) {
      expect(Math.hypot(b.x - eave.x, b.z - eave.z)).toBeCloseTo(eave.radius, 6);
      // The camera looks from −z.
      expect(b.z).toBeLessThan(eave.z);
      expect(b.y).toBeLessThanOrEqual(eave.y);
      expect(b.y).toBeGreaterThanOrEqual(eave.y - B.sag);
    }
    const coil = bulbs.slice(6 * B.perEdge, 6 * B.perEdge + B.perPost);
    for (const b of coil) {
      expect(Math.hypot(b.x - post.x, b.z - post.z)).toBeCloseTo(post.radius, 6);
      expect(b.y).toBeGreaterThan(post.y);
      expect(b.y).toBeLessThanOrEqual(post.y + post.height);
    }
  });

  it('keeps a swag smaller than an edge bulb, and leaves out edge bulbs under a building', () => {
    const t0 = tile(0, 0);
    const c = hexToWorld(t0, SIZE);
    const bare = tileBulbs(t0, SIZE, FULL);
    expect(bare.every((b) => (b.scale ?? 1) === 1)).toBe(true);
    // A wide building on the east side reaches over edge 0.
    const wide = {
      x: c.x + SIZE * 0.6,
      z: c.z,
      y: 0.8,
      radius: SIZE * 0.36,
      footprint: SIZE * 0.4,
    };
    const bulbs = tileBulbs(tile(0, 0, { eaves: [wide] }), SIZE, FULL);
    const swag = bulbs.slice(-B.perEave);
    expect(swag.every((b) => b.scale === B.eaveScale)).toBe(true);
    expect(B.eaveScale).toBeLessThan(1);
    const edges = bulbs.slice(0, -B.perEave);
    expect(edges.length).toBeLessThan(6 * B.perEdge);
    for (const b of edges) {
      expect(Math.hypot(b.x - wide.x, b.z - wide.z)).toBeGreaterThanOrEqual(
        wide.footprint + B.size * B.core,
      );
    }
  });

  it('hangs no swag on a flat building, but keeps the edge bulbs off it', () => {
    const t0 = tile(0, 0);
    const c = hexToWorld(t0, SIZE);
    const pad = { x: c.x + SIZE * 0.6, z: c.z, y: 0.35, radius: 0.2, footprint: 0.25, flat: true };
    const bulbs = tileBulbs(tile(0, 0, { eaves: [pad] }), SIZE, FULL);
    expect(bulbs.every((b) => (b.scale ?? 1) === 1)).toBe(true);
    expect(bulbs.length).toBeLessThan(6 * B.perEdge);
    for (const b of bulbs) {
      expect(Math.hypot(b.x - pad.x, b.z - pad.z)).toBeGreaterThanOrEqual(pad.footprint);
    }
  });

  it('mixes the four colours along a string, and neighbours start apart', () => {
    const bulbs = tileBulbs(tile(0, 0), SIZE, FULL);
    expect(new Set(bulbs.map((b) => b.color))).toEqual(new Set([0, 1, 2, 3]));
    for (let i = 1; i < bulbs.length; i++) {
      expect(bulbs[i]!.color).not.toBe(bulbs[i - 1]!.color);
    }
    const firsts = new Set(
      [tile(0, 0), tile(1, 0), tile(0, 1), tile(-1, 1), tile(3, -2)].map(
        (t) => tileBulbs(t, SIZE, FULL)[0]?.color,
      ),
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('gives every string its full count while the patch fits, and respaces past it', () => {
    expect(bulbCounts(1, 1, 1000)).toEqual(FULL);
    // Swags and coils keep a few, the edges share the rest, then the coil and swags top up.
    expect(bulbCounts(2, 1, 30)).toEqual({ perEdge: 3, perEave: 4, perPost: 4 });
    expect(bulbCounts(2, 1, 40)).toEqual({ perEdge: 4, perEave: 5, perPost: 5 });
    // A busy patch (600 over 24 tiles) still swags its house and coils its post.
    expect(bulbCounts(1, 1, 25)).toEqual({ perEdge: 3, perEave: 4, perPost: 3 });
    // A tile sharing two edges with lit neighbours strings four.
    expect(bulbCounts(1, 1, 25, 4)).toEqual({ perEdge: 4, perEave: 4, perPost: 5 });
    // Too little room even for that: edges first.
    expect(bulbCounts(0, 1, 13)).toEqual({ perEdge: 2, perEave: 0, perPost: 1 });
    expect(bulbCounts(0, 0, 0)).toEqual({ perEdge: 0, perEave: 0, perPost: 0 });
    // Fewer bulbs on a string still span its whole edge, evenly.
    const few = tileBulbs(tile(0, 0), SIZE, { perEdge: 2, perEave: 0, perPost: 0 });
    expect(few).toHaveLength(12);
  });

  it('strings a shared edge once between two lit neighbours', () => {
    const a = tile(0, 0);
    const b = tile(1, 0); // across edge 0 of a
    const both = bulbLayout([a, b], SIZE);
    const alone = tileBulbs(a, SIZE, FULL).length;
    expect(both).toHaveLength(alone * 2 - B.perEdge);
    // No two bulbs hang in the same spot.
    const spots = new Set(both.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    expect(spots.size).toBe(both.length);
  });

  it('hands a shared edge to the neighbour when one side covers it, and strings it once', () => {
    const a = tile(0, 0); // key "0,0" sorts first
    const ca = hexToWorld(hex(0, 0), SIZE);
    const cb = hexToWorld(hex(1, 0), SIZE); // across a's edge 0 (b's edge 3)
    const inset = SIZE * FENCE_INSET * (Math.sqrt(3) / 2);
    // Bulbs on a's side of the edge stand near x = ca + inset; b's near x = cb - inset.
    const near = (bulbs: readonly { x: number; z: number }[], x: number) =>
      bulbs.filter((p) => Math.abs(p.x - x) < 0.03 && Math.abs(p.z - ca.z) < SIZE * 0.4);
    // A small pad over the middle of a's edge 0.
    const pad = { x: ca.x + inset, z: ca.z, y: 0.4, radius: 0.05, footprint: 0.06, flat: true };
    const covered = { ...a, eaves: [pad] };
    expect(edgeCovered(covered, 0, SIZE)).toBe(true);
    const handed = bulbLayout([covered, tile(1, 0)], SIZE);
    expect(near(handed, ca.x + inset)).toHaveLength(0);
    expect(near(handed, cb.x - inset)).toHaveLength(B.perEdge);
    // Neither covered: the first key strings it, once.
    const plain = bulbLayout([a, tile(1, 0)], SIZE);
    expect(near(plain, ca.x + inset)).toHaveLength(B.perEdge);
    expect(near(plain, cb.x - inset)).toHaveLength(0);
    // Both covered: the first key keeps it (its uncovered ends), the other leaves it.
    const padB = { ...pad, x: cb.x - inset };
    const both = bulbLayout([covered, tile(1, 0, { eaves: [padB] })], SIZE);
    expect(near(both, cb.x - inset)).toHaveLength(0);
    expect(near(both, ca.x + inset).length).toBeGreaterThan(0);
  });

  it('never spends more than its room, even with no edge of its own to string', () => {
    for (const [eaves, posts, room] of [
      [1, 1, 0],
      [6, 1, 5],
      [2, 1, 9],
    ] as const) {
      const c = bulbCounts(eaves, posts, room, 0);
      expect(c.perEave).toBeGreaterThanOrEqual(0);
      expect(c.perPost).toBeGreaterThanOrEqual(0);
      expect(c.perEave * eaves + c.perPost * posts).toBeLessThanOrEqual(room);
    }
  });

  it('never passes the cap, and draws nothing with no lit tile', () => {
    const tiles = Array.from({ length: 40 }, (_, i) => tile(i, 0));
    expect(bulbLayout(tiles, SIZE).length).toBeLessThanOrEqual(B.cap);
    expect(bulbLayout(tiles, SIZE, 7).length).toBeLessThanOrEqual(7);
    expect(bulbLayout([], SIZE)).toEqual([]);
  });

  it('finds the tiles holding a lights building, once each', () => {
    const view = testView(1);
    const [a, b] = view.tiles.filter((t) => t.ownerUserId !== null);
    if (!a || !b) throw new Error('no owned tiles');
    const lights = (spot: number) => ({
      id: `0190a8c4-0000-7000-8000-00000000${String(100 + spot)}`,
      buildingId: 'twinkle-lights',
      kind: 'lights' as const,
      level: 1,
      spot,
      lit: null,
      safeRadius: null,
    });
    const tiles = view.tiles.map((t) =>
      t === a ? { ...t, buildings: [lights(1), lights(2)] } : t,
    );
    expect(litTiles({ tiles }).map((t) => [t.q, t.r])).toEqual([[a.q, a.r]]);
    expect(litTiles(view)).toEqual([]);
  });
});
