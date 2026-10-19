import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { HOUSE_DATA, roomsAt, type HouseRoomLook } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HOUSE_GRID } from './house-config.js';
import { roomBox, wallRuns, type RoomBox } from './house-layout.js';
import { doorLanes, inLane } from './house-walk.js';
import type { QualityTier } from '../engine/config.js';
// The grown builders load before house-rooms.ts on purpose: registration
// must work in either order of the import cycle (function declarations).
import { heartHallRoom, kitchenRoom, playroomRoom } from './house-rooms-grown.js';
import { gallery } from './house-models.js';
import { roomBuilder, type FloorSpot, type RoomKit } from './house-rooms.js';

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
    bedYaws: [] as number[],
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
    lanes: [],
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
    bed: (x, z, yaw) => {
      made.beds.push({ x, z });
      made.bedYaws.push(yaw);
    },
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
      // The box runs along the walls' centre lines: nothing pokes into a wall
      // (render check r2: the chest's lid showed above the cut wall's cap).
      const inset = HOUSE_GRID.wall / 2 - 0.005;
      for (const p of made.points) {
        expect(p.x).toBeGreaterThanOrEqual(box.x0 + inset);
        expect(p.x).toBeLessThanOrEqual(box.x1 - inset);
        expect(p.z).toBeGreaterThanOrEqual(box.z0 - 0.01);
        expect(p.z).toBeLessThanOrEqual(box.z1 - inset);
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
      // And clear of the beds (1.5 wide, 1.1 deep, turned by their yaw).
      for (const r of residents)
        made.beds.forEach((b, i) => {
          const along = Math.abs(Math.sin(made.bedYaws[i]!)) > 0.5;
          const hx = (along ? 1.1 : 1.5) / 2 + clear;
          const hz = (along ? 1.5 : 1.1) / 2 + clear;
          const onBed = Math.abs(r.x - b.x) < hx && Math.abs(r.z - b.z) < hz;
          expect(onBed, `${look} resident on the bed at ${b.x.toFixed(2)}, ${b.z.toFixed(2)}`).toBe(
            false,
          );
        });
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

  describe('doorway lanes (#381 W3)', () => {
    const lanesOf = (look: HouseRoomLook) => {
      const rooms = roomsAt(HOUSE_DATA, HOUSE_DATA.levels.length);
      const id = rooms.find((r) => r.look === look)!.id;
      return doorLanes(wallRuns(rooms)).filter((l) => l.room === id);
    };

    it('stands the Kitchen counter under the shelves when the loft doorway takes the back wall', () => {
      scene = new Scene(new NullEngine());
      const { k, made, box } = kit(scene, 'kitchen');
      const lanes = lanesOf('kitchen');
      expect(lanes.length).toBeGreaterThan(0);
      kitchenRoom({ ...k, lanes });
      const blocking = made.pieces.filter((p) => p.y0 < box.y0 + 0.3 && p.y1 - p.y0 > 0.15);
      expect(blocking.filter((p) => inLane(lanes, p, box.y0))).toEqual([]);
      // The counter (0.9 m tall, 2 m long) runs along the west wall.
      const counter = blocking.find((p) => p.z1 - p.z0 > 1.8 && p.x1 - p.x0 < 0.8);
      expect(counter).toBeDefined();
      expect(counter!.x0).toBeLessThan(box.x0 + HOUSE_GRID.wall);
    });

    it('keeps it along the back wall with no doorway there (level 3)', () => {
      scene = new Scene(new NullEngine());
      const { k, made, box } = kit(scene, 'kitchen');
      kitchenRoom(k);
      const counter = made.pieces.find((p) => p.x1 - p.x0 > 1.8 && p.z1 - p.z0 < 0.8);
      expect(counter).toBeDefined();
      expect(counter!.z1).toBeGreaterThan(box.z1 - 0.4);
    });
  });

  it('opens the gallery’s rail where the stairs come up and the walkway joins (W3)', () => {
    scene = new Scene(new NullEngine());
    const open: [number, number][] = [
      [-4, -3],
      [3.5, 4.5],
    ];
    const parts = gallery(scene, 9.36, 1.3, 3, open);
    for (const m of parts) m.computeWorldMatrix(true);
    // The rail: everything standing on the deck's front edge.
    const rail = parts.filter((m) => {
      const b = m.getBoundingInfo().boundingBox;
      return b.maximumWorld.y > 0.05 && b.maximumWorld.z < -0.5;
    });
    expect(rail.length).toBeGreaterThan(4);
    for (const m of rail) {
      const b = m.getBoundingInfo().boundingBox;
      for (const [a, c] of open) {
        const inside = b.minimumWorld.x < c - 1e-6 && b.maximumWorld.x > a + 1e-6;
        expect(
          inside,
          `rail piece at ${String(b.minimumWorld.x)}…${String(b.maximumWorld.x)}`,
        ).toBe(false);
      }
    }
    // With no gaps it runs the whole width.
    const whole = gallery(scene, 9.36, 1.3, 3).filter((m) => {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      return (
        b.maximumWorld.y > 0.8 && b.maximumWorld.z < -0.5 && b.maximumWorld.x - b.minimumWorld.x > 9
      );
    });
    expect(whole.length).toBeGreaterThan(0);
  });
});
