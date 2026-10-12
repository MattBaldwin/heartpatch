import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { HOUSE_DATA, roomsAt } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { roomBox } from './house-layout.js';
import {
  hasRoomBuilder,
  plainRoom,
  registerRoom,
  roomBuilder,
  snugRoom,
  type RoomKit,
} from './house-rooms.js';

function kit(scene: Scene, level: number, index: number) {
  const room = roomsAt(HOUSE_DATA, level)[index]!;
  const made = { solid: 0, glow: 0, beds: 0, lights: [] as string[], signs: 0 };
  const k: RoomKit = {
    scene,
    box: roomBox(room),
    solid: (parts) => (made.solid += parts.length),
    glow: (parts) => (made.glow += parts.length),
    bed: () => (made.beds += 1),
    shadow: () => undefined,
    pool: () => undefined,
    light: (kind) => made.lights.push(kind),
    heartSeed: () => undefined,
    sign: () => (made.signs += 1),
  };
  return { k, made, room };
}

let scene: Scene;
afterEach(() => {
  scene.getEngine().dispose();
});

describe('room builders', () => {
  it('registers the Snug; other looks draw as the plain room until they get theirs', () => {
    scene = new Scene(new NullEngine());
    expect(hasRoomBuilder('snug')).toBe(true);
    expect(roomBuilder('snug')).toBe(snugRoom);
    expect(roomBuilder('heart-hall')).toBe(plainRoom);
  });

  it('lets a look plug in by registering a builder', () => {
    scene = new Scene(new NullEngine());
    const custom = () => ({ keeper: null, residents: [] });
    registerRoom('kitchen', custom);
    expect(roomBuilder('kitchen')).toBe(custom);
  });

  it('furnishes the Snug: a bed per bed, a fire and a lamp to light, the sign, the Keeper by the fire', () => {
    scene = new Scene(new NullEngine());
    const { k, made, room } = kit(scene, 1, 0);
    const plan = snugRoom(k);
    expect(made.beds).toBe(room.beds);
    expect(made.lights).toEqual(['fire', 'lamp']);
    expect(made.signs).toBe(1);
    expect(made.glow).toBeGreaterThan(0);
    expect(plan.keeper).not.toBeNull();
    expect(plan.residents.length).toBeGreaterThanOrEqual(room.beds);
    // Everyone stands inside the room.
    for (const s of [plan.keeper!, ...plan.residents]) {
      expect(s.x).toBeGreaterThan(k.box.x0);
      expect(s.x).toBeLessThan(k.box.x1);
      expect(s.z).toBeGreaterThan(k.box.z0);
      expect(s.z).toBeLessThan(k.box.z1);
    }
  });

  it('gives the plain room its beds and somewhere for each resident to stand', () => {
    scene = new Scene(new NullEngine());
    const top = HOUSE_DATA.levels.length;
    const rooms = roomsAt(HOUSE_DATA, top);
    rooms.forEach((room, i) => {
      const { k, made } = kit(scene, top, i);
      const plan = plainRoom(k);
      expect(made.beds).toBe(room.beds);
      expect(plan.residents).toHaveLength(room.beds);
    });
  });
});
