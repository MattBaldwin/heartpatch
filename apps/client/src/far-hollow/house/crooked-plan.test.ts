import { CROOKED_HOUSE, type CrookedHouseView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  arrivalSpot,
  CROOKED_CAMERA,
  CROOKED_WALK,
  crookedThings,
  doorEnd,
  doorState,
  fitShot,
  floorBox,
  focusShot,
  litRooms,
  nearestTarget,
  roomOf,
  roomStart,
  tapGoal,
  thingPoint,
  WAKE_LOOK,
  walkStep,
} from './crooked-plan.js';

const door = (id: string) => {
  const d = CROOKED_HOUSE.doors.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const room = (id: string) => {
  const r = roomOf(id);
  if (!r) throw new Error(id);
  return r;
};

/** A fresh arrival's house: in the Front Hall, nothing found. */
function arrived(over: Partial<CrookedHouseView> = {}): CrookedHouseView {
  return {
    room: 'front-hall',
    lastLitRoom: 'front-hall',
    keys: [],
    unlocked: [],
    bonusOpen: [],
    chestsOpened: [],
    rooms: CROOKED_HOUSE.rooms
      .filter((r) => r.kind === 'main')
      .map((r) => ({ id: r.id, fixed: [], bloomed: r.id === 'front-hall' })),
    echoes: [],
    serverTime: '2026-10-30T16:00:00.000Z',
    ...over,
  };
}

describe('the Crooked House as the screen walks it (#306 6c)', () => {
  it('lights the start and the bloomed rooms, and a bonus room or the attic once its door is open', () => {
    const lit = litRooms(arrived());
    expect(lit.has('front-hall')).toBe(true);
    expect(lit.has('parlour')).toBe(false);
    expect(lit.has('inglenook')).toBe(false);
    expect(lit.has('attic')).toBe(false);
    expect(litRooms(arrived({ bonusOpen: ['inglenook-door'] })).has('inglenook')).toBe(true);
  });

  it('says how each door stands: open, locked (key held or not), or asleep behind a power', () => {
    const fresh = arrived();
    expect(doorState(door('parlour-door'), fresh).kind).toBe('open');
    expect(doorState(door('north-door'), fresh)).toEqual({
      kind: 'locked',
      key: 'brass-key',
      held: false,
    });
    expect(doorState(door('north-door'), arrived({ keys: ['brass-key'] }))).toEqual({
      kind: 'locked',
      key: 'brass-key',
      held: true,
    });
    expect(
      doorState(door('north-door'), arrived({ keys: ['brass-key'], unlocked: ['north-door'] }))
        .kind,
    ).toBe('open');
    expect(doorState(door('inglenook-door'), fresh)).toMatchObject({
      kind: 'sleeping',
      power: 'fire',
    });
  });

  it('keeps the Keeper inside its walls, except through an open doorway', () => {
    const hall = room('front-hall');
    const view = arrived();
    // Far past the east wall, away from any door: held a margin inside.
    const east = walkStep(hall, view, { x: 9, z: -2 });
    expect(east.at.x).toBeCloseTo(hall.box.w / 2 - CROOKED_WALK.margin);
    expect(east.crossed).toBeNull();
    // Into the west doorway (the Parlour, open): through it.
    const west = doorEnd(door('parlour-door'), 'front-hall')!;
    const through = walkStep(hall, view, { x: west.point.x - 1, z: west.point.z });
    expect(through.crossed?.id).toBe('parlour-door');
    // Into the north doorway (the Brass lock): stopped, and it says which door.
    const north = doorEnd(door('north-door'), 'front-hall')!;
    const bump = walkStep(hall, view, { x: north.point.x, z: north.point.z + 1 });
    expect(bump.crossed).toBeNull();
    expect(bump.bumped?.id).toBe('north-door');
    expect(bump.at.z).toBeCloseTo(hall.box.z + hall.box.d / 2 - CROOKED_WALK.margin);
  });

  it('lands a step through a door just inside the room beyond, and a reload in the room', () => {
    const p = arrivalSpot(door('parlour-door'), 'parlour')!;
    const parlour = room('parlour');
    expect(p.x).toBeLessThan(parlour.box.x + parlour.box.w / 2);
    expect(p.x).toBeGreaterThan(parlour.box.x);
    const start = roomStart(parlour);
    expect(Math.abs(start.x - parlour.box.x)).toBeLessThan(parlour.box.w / 2);
  });

  it('names the nearest crooked thing, or a shut door, within reach', () => {
    const parlour = room('parlour');
    const view = arrived({ room: 'parlour' });
    const picture = parlour.things.find((t) => t.id === 'picture')!;
    const p = thingPoint(parlour, picture);
    expect(nearestTarget(parlour, view, { x: p.x, z: p.z - 0.8 })).toMatchObject({
      kind: 'thing',
      thing: { id: 'picture' },
    });
    // Once it's fixed, it's not in front any more.
    const fixed = arrived({
      room: 'parlour',
      rooms: view.rooms.map((r) => (r.id === 'parlour' ? { ...r, fixed: ['picture'] } : r)),
    });
    expect(crookedThings(parlour, fixed).map((t) => t.id)).not.toContain('picture');
    const hall = room('front-hall');
    const north = doorEnd(door('north-door'), 'front-hall')!;
    expect(
      nearestTarget(hall, arrived(), { x: north.point.x, z: north.point.z - 0.6 }),
    ).toMatchObject({
      kind: 'door',
      door: { id: 'north-door' },
      state: { kind: 'locked' },
    });
    expect(nearestTarget(hall, arrived(), { x: 0, z: -1.5 })).toBeNull();
  });

  it('walks a tap near a crooked thing up beside it, from the Keeper’s side', () => {
    const parlour = room('parlour');
    const view = arrived({ room: 'parlour' });
    const chair = parlour.things.find((t) => t.id === 'armchair')!;
    const p = thingPoint(parlour, chair);
    const goal = tapGoal(parlour, view, { x: p.x, z: p.z - 3 }, { x: p.x + 0.1, z: p.z });
    expect(Math.hypot(goal.x - p.x, goal.z - p.z)).toBeCloseTo(0.9, 1);
    expect(goal.z).toBeLessThan(p.z);
    // A tap on bare floor goes straight there.
    expect(tapGoal(parlour, view, p, { x: parlour.box.x, z: parlour.box.z - 2 })).toEqual({
      x: parlour.box.x,
      z: parlour.box.z - 2,
    });
  });

  it('fits a room in the free band of any phone, further back on a narrow one', () => {
    const box = room('parlour').box;
    const phone = fitShot(box, { aspect: 393 / 852, fov: 0.75, top: 0.13, bottom: 0.22 });
    const se = fitShot(box, { aspect: 375 / 667, fov: 0.75, top: 0.16, bottom: 0.28 });
    const pad = fitShot(box, { aspect: 1080 / 810, fov: 0.75, top: 0.1, bottom: 0.15 });
    expect(phone.distance).toBeGreaterThan(pad.distance);
    expect(se.distance).toBeGreaterThan(0);
    // Across the phone, the room's width plus a margin fills the view's width.
    const halfWide = Math.tan(0.75 / 2) * (393 / 852) * phone.distance;
    expect(halfWide).toBeGreaterThanOrEqual(box.w / 2 + CROOKED_CAMERA.margin - 1e-9);
    // The HUD covers more at the bottom: the camera aims south of the room's middle.
    expect(phone.target.z).toBeLessThan(box.z + 1);
    expect(phone.pitch).toBe(CROOKED_CAMERA.pitch);
  });

  it('frames a whole floor for the dollhouse map', () => {
    const ground = floorBox(0);
    expect(ground.w).toBeGreaterThan(20);
    const up = floorBox(1);
    expect(up.w).toBeLessThanOrEqual(ground.w + 1);
  });
});

describe('the look at a woken door (#306)', () => {
  it('aims at the point, closer, at the same pitch', () => {
    const shot = { target: { x: 0, z: 0 }, pitch: 1, distance: 20 };
    const look = focusShot(shot, { x: -5, z: 2 });
    expect(look.target).toEqual({ x: -5, z: 2 });
    expect(look.pitch).toBe(1);
    expect(look.distance).toBeCloseTo(20 * WAKE_LOOK.zoom);
  });
});
