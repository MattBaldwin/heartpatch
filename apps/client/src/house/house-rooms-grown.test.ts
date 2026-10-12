import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { HOUSE_DATA, roomsAt, type HouseRoomLook } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { roomBox, type RoomBox } from './house-layout.js';
import type { QualityTier } from '../engine/config.js';
import { roomBuilder, type FloorSpot, type RoomKit } from './house-rooms.js';
import { heartHallRoom, kitchenRoom, playroomRoom } from './house-rooms-grown.js';

/** A kit that records what a builder asks for, for the room with `look` at the top level. */
function kit(scene: Scene, look: HouseRoomLook, beds?: number, tier: QualityTier = 'low') {
  const top = HOUSE_DATA.levels.length;
  const room = roomsAt(HOUSE_DATA, top).find((r) => r.look === look)!;
  const base = roomBox(room);
  const box: RoomBox = { ...base, beds: beds ?? base.beds };
  const made = {
    solid: 0,
    glow: 0,
    beds: [] as FloorSpot[],
    lights: [] as string[],
    signs: 0,
    seeds: 0,
    points: [] as { x: number; y: number; z: number }[],
    /** Each piece's box on the floor plan, and how high it starts and reaches. */
    pieces: [] as { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }[],
  };
  const k: RoomKit = {
    scene,
    box,
    tier,
    solid: (parts) => {
      made.solid += parts.length;
      for (const p of parts) {
        const b = p.getBoundingInfo().boundingBox;
        made.points.push(b.minimumWorld, b.maximumWorld);
        made.pieces.push({
          x0: b.minimumWorld.x,
          x1: b.maximumWorld.x,
          z0: b.minimumWorld.z,
          z1: b.maximumWorld.z,
          y0: b.minimumWorld.y,
          y1: b.maximumWorld.y,
        });
      }
    },
    glow: (parts) => (made.glow += parts.length),
    bed: (x, z) => made.beds.push({ x, z }),
    shadow: () => undefined,
    pool: () => undefined,
    light: (kind) => made.lights.push(kind),
    heartSeed: () => (made.seeds += 1),
    sign: () => (made.signs += 1),
  };
  return { k, made, box };
}

const inside = (box: RoomBox, s: FloorSpot) =>
  s.x > box.x0 && s.x < box.x1 && s.z > box.z0 && s.z < box.z1;

let scene: Scene;
afterEach(() => {
  scene.getEngine().dispose();
});

describe('the grown rooms', () => {
  it('registers a builder for each grown look', () => {
    scene = new Scene(new NullEngine());
    expect(roomBuilder('playroom')).toBe(playroomRoom);
    expect(roomBuilder('kitchen')).toBe(kitchenRoom);
    expect(roomBuilder('heart-hall')).toBe(heartHallRoom);
  });

  for (const [look, builder] of [
    ['playroom', playroomRoom],
    ['kitchen', kitchenRoom],
    ['heart-hall', heartHallRoom],
  ] as const) {
    it(`furnishes the ${look}: a bed per bed, a light, everyone inside, the Keeper left in the Snug`, () => {
      scene = new Scene(new NullEngine());
      const { k, made, box } = kit(scene, look);
      const plan = builder(k);
      expect(made.beds).toHaveLength(box.beds);
      expect(made.solid).toBeGreaterThan(0);
      expect(made.lights).toHaveLength(1);
      // The house has one name sign and one Heart Seed keepsake, both in the Snug.
      expect(made.signs).toBe(0);
      expect(made.seeds).toBe(0);
      expect(plan.keeper).toBeNull();
      expect(plan.residents.length).toBeGreaterThanOrEqual(box.beds);
      for (const s of [...plan.residents, ...made.beds]) expect(inside(box, s)).toBe(true);
    });

    it(`keeps the ${look}'s furniture inside its walls and under its ceiling`, () => {
      scene = new Scene(new NullEngine());
      const { k, made, box } = kit(scene, look);
      builder(k);
      const slack = 0.15; // the back wall's inner half: pieces stand against it
      for (const p of made.points) {
        expect(p.x).toBeGreaterThanOrEqual(box.x0 - slack);
        expect(p.x).toBeLessThanOrEqual(box.x1 + slack);
        expect(p.z).toBeGreaterThanOrEqual(box.z0 - slack);
        expect(p.z).toBeLessThanOrEqual(box.z1 + slack);
        expect(p.y).toBeGreaterThanOrEqual(box.y0 - 0.01);
        expect(p.y).toBeLessThanOrEqual(box.y1);
      }
    });

    it(`stands the ${look}'s residents clear of its furniture (render check: the Kitchen's stools)`, () => {
      scene = new Scene(new NullEngine());
      const { k, made, box } = kit(scene, look);
      const { residents } = builder(k);
      // Pieces standing on the floor: not flat rugs and mats, not lanterns hanging overhead.
      const standing = made.pieces.filter((p) => p.y1 > box.y0 + 0.1 && p.y0 < box.y0 + 1.0);
      const clear = 0.2;
      for (const r of residents)
        for (const p of standing) {
          const inside =
            r.x > p.x0 - clear && r.x < p.x1 + clear && r.z > p.z0 - clear && r.z < p.z1 + clear;
          expect(inside, `${look} resident at ${r.x.toFixed(2)}, ${r.z.toFixed(2)}`).toBe(false);
        }
    });

    it(`keeps the ${look}'s residents apart, so faces don't overlap`, () => {
      scene = new Scene(new NullEngine());
      const { k } = kit(scene, look);
      const { residents } = builder(k);
      for (let i = 0; i < residents.length; i++)
        for (let j = i + 1; j < residents.length; j++) {
          const a = residents[i]!;
          const b = residents[j]!;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.9);
        }
    });
  }

  it('glows on every tier but the Kitchen on low, where its stove fire is solid (no draw call upstairs)', () => {
    for (const tier of ['low', 'medium', 'high'] as const)
      for (const [look, builder] of [
        ['playroom', playroomRoom],
        ['kitchen', kitchenRoom],
        ['heart-hall', heartHallRoom],
      ] as const) {
        scene = new Scene(new NullEngine());
        const { k, made } = kit(scene, look, undefined, tier);
        builder(k);
        expect(made.glow > 0, `${look} on ${tier}`).toBe(!(look === 'kitchen' && tier === 'low'));
        scene.getEngine().dispose();
      }
    scene = new Scene(new NullEngine());
  });

  it('beds the Heart Hall apart under its gallery, whatever its bed count', () => {
    // One row under the gallery holds 5 (the data has 4); residents still find room at 12.
    for (const beds of [1, 2, 4, 5, 12]) {
      scene = new Scene(new NullEngine());
      const { k, made, box } = kit(scene, 'heart-hall', beds);
      heartHallRoom(k);
      expect(made.beds).toHaveLength(beds);
      const xs = made.beds.map((b) => b.x).sort((a, b) => a - b);
      if (beds <= 5)
        for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(1.5);
      for (const b of made.beds) expect(inside(box, b)).toBe(true);
      const { residents } = heartHallRoom(kit(scene, 'heart-hall', beds).k);
      expect(residents.length).toBeGreaterThanOrEqual(beds);
      for (const r of residents) expect(inside(box, r)).toBe(true);
      for (let i = 0; i < residents.length; i++)
        for (let j = i + 1; j < residents.length; j++)
          expect(
            Math.hypot(residents[i]!.x - residents[j]!.x, residents[i]!.z - residents[j]!.z),
          ).toBeGreaterThan(0.9);
      scene.getEngine().dispose();
    }
    scene = new Scene(new NullEngine());
  });
});
