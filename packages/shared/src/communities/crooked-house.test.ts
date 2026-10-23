import { describe, expect, it } from 'vitest';
import { CROOKED_HOUSE } from '../data/crooked-house.js';
import { MEMORY_PUZZLES } from '../data/memory-puzzles.js';
import { findAvoidedWords } from '../data/avoided-words.js';
import { CrookedHouseSchema, type CrookedHouse } from '../schemas/data/crooked-house.js';
import {
  allBits,
  bitCount,
  doorBetween,
  doorOpen,
  echoAt,
  echoCatch,
  echoDistance,
  hasBit,
  houseReach,
  doorLeadsTo,
  reachWithKeys,
  withBit,
} from './crooked-house.js';

const house = CROOKED_HOUSE;
const loop = house.echoLoops[0]!;
const doorBit = (id: string) => house.doors.findIndex((d) => d.id === id);

describe('CROOKED_HOUSE (#306 6b)', () => {
  it('is valid data, fixed as the owner approved it (decisions 5 and 8)', () => {
    expect(CrookedHouseSchema.parse(house)).toEqual(house);
    const main = house.rooms.filter((r) => r.kind === 'main');
    // Thirteen main rooms: the lit Front Hall and twelve to put right (twelve story scraps).
    expect(main).toHaveLength(13);
    expect(main.filter((r) => r.things.length > 0)).toHaveLength(12);
    expect(house.rooms.filter((r) => r.kind === 'bonus').map((r) => r.id)).toEqual([
      'pantry',
      'inglenook',
      'hanging-garden',
      'lantern-closet',
    ]);
    expect(house.keys.map((k) => k.id)).toEqual([
      'brass-key',
      'copper-key',
      'silver-key',
      'iron-key',
      'little-key',
      'attic-key',
    ]);
    // Two Relight rooms: the Library 5×5 and the Music Room 6×6.
    const puzzles = main.flatMap((r) =>
      r.things.filter((t) => t.puzzle).map((t) => [r.id, MEMORY_PUZZLES.relight[t.puzzle!].size]),
    );
    expect(puzzles).toEqual([
      ['library', 5],
      ['music-room', 6],
    ]);
    // Every main room but the start has something to put right; it's lit already.
    for (const room of main) expect(room.things.length > 0).toBe(room.id !== house.start);
    expect(new Set(house.doors.map((d) => d.power))).toEqual(
      new Set([undefined, 'fire', 'water', 'leaf', 'light']),
    );
  });

  it('chains its keys: each hides only where the keys before it reach, never behind itself', () => {
    house.keys.forEach((key, i) => {
      const reach = reachWithKeys(house, i);
      for (const room of key.hidesIn) expect(reach.has(room), `${key.id} in ${room}`).toBe(true);
      // And it opens somewhere new.
      expect(reachWithKeys(house, i + 1).size).toBeGreaterThan(reach.size);
    });
    // With every key, every room is reachable.
    expect(reachWithKeys(house, house.keys.length)).toEqual(new Set(house.rooms.map((r) => r.id)));
  });

  it('starts with only the unlocked rooms', () => {
    expect([...houseReach(house, { unlocked: 0, bonusOpen: 0 })].sort()).toEqual([
      'conservatory',
      'front-hall',
      'parlour',
    ]);
    const brass = withBit(withBit(0, doorBit('north-door')), doorBit('parlour-back-door'));
    const reach = houseReach(house, { unlocked: brass, bonusOpen: 0 });
    expect(reach.has('kitchen')).toBe(true);
    expect(reach.has('library')).toBe(false);
    expect(reach.has('landing')).toBe(false);
    expect(reach.has('pantry')).toBe(false);
  });

  it('opens a power door only with its power, and a key door only with its key turned', () => {
    const pantry = house.doors[doorBit('pantry-door')]!;
    const north = house.doors[doorBit('north-door')]!;
    const open = house.doors[doorBit('parlour-door')]!;
    const none = { unlocked: 0, bonusOpen: 0 };
    expect(doorOpen(house, open, none)).toBe(true);
    expect(doorOpen(house, pantry, none)).toBe(false);
    expect(doorOpen(house, pantry, { unlocked: allBits(31), bonusOpen: 0 })).toBe(false);
    expect(doorOpen(house, pantry, { unlocked: 0, bonusOpen: withBit(0, doorBit('pantry-door')) })).toBe(true);
    expect(doorOpen(house, north, { unlocked: withBit(0, doorBit('north-door')), bonusOpen: 0 })).toBe(true);
    expect(doorBetween(house, 'parlour', 'front-hall')).toBe(open);
    expect(doorBetween(house, 'parlour', 'kitchen')).toBeNull();
    expect(doorLeadsTo(open, 'front-hall')).toBe('parlour');
    expect(doorLeadsTo(open, 'kitchen')).toBeNull();
  });

  it('keeps the words short and kind (style guide §2, §9)', () => {
    const words = [
      house.name,
      ...house.rooms.flatMap((r) => [r.name, ...r.things.map((t) => t.name)]),
      ...house.keys.map((k) => k.name),
      ...house.doors.flatMap((d) => (d.sleeper ? [d.sleeper] : [])),
    ];
    for (const w of words) expect(findAvoidedWords(w), w).toEqual([]);
  });

  it('refuses a house that breaks its own rules', () => {
    const broken = (edit: (h: CrookedHouse) => void) => {
      const copy = structuredClone(house);
      edit(copy);
      return CrookedHouseSchema.safeParse(copy).success;
    };
    expect(broken(() => undefined)).toBe(true);
    expect(broken((h) => h.doors.push({ ...h.doors[0]! }))).toBe(false);
    expect(broken((h) => (h.doors[0]!.a.room = 'nowhere'))).toBe(false);
    expect(broken((h) => (h.keys[0]!.hidesIn = ['front-hall']))).toBe(false);
    expect(broken((h) => delete h.doors[doorBit('pantry-door')]!.power)).toBe(false);
    expect(broken((h) => (h.echoLoops[0]!.rooms = ['front-hall', 'parlour']))).toBe(false);
    expect(broken((h) => (h.start = 'attic'))).toBe(false);
  });
});

describe('bits', () => {
  it('set, test and count', () => {
    const m = withBit(withBit(0, 0), 5);
    expect(hasBit(m, 0)).toBe(true);
    expect(hasBit(m, 5)).toBe(true);
    expect(hasBit(m, 1)).toBe(false);
    expect(hasBit(m, -1)).toBe(false);
    expect(bitCount(m, 6)).toBe(2);
    expect(bitCount(m, 5)).toBe(1);
    expect(allBits(3)).toBe(7);
    expect(allBits(31)).toBe(0x7fffffff);
  });
});

describe('echoes', () => {
  it('drift round their loop one lap a period, from their offset', () => {
    const phase = { offset: 0, direction: 1 as const };
    const lap = loop.periodSeconds * 1000;
    expect(echoAt(loop, phase, 0)).toBe(0);
    expect(echoAt(loop, phase, lap / 2)).toBeCloseTo(loop.rooms.length / 2, 10);
    expect(echoAt(loop, phase, lap)).toBeCloseTo(0, 10);
    expect(echoAt(loop, { offset: 0.25, direction: 1 }, 0)).toBeCloseTo(0.5, 10);
    // Backwards round the loop, still in [0, n).
    const back = echoAt(loop, { offset: 0, direction: -1 }, lap / 4);
    expect(back).toBeCloseTo(1.5, 10);
    for (let t = 0; t < 3 * lap; t += 997) {
      const p = echoAt(loop, { offset: 0.9, direction: -1 }, Date.parse('2026-10-31T00:00:00Z') + t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(loop.rooms.length);
    }
  });

  it('measure how far they are from a room, round the loop', () => {
    const [a, b] = loop.rooms as [string, string];
    expect(echoDistance(loop, 0, a)).toBe(0);
    expect(echoDistance(loop, 0.25, a)).toBe(0.25);
    expect(echoDistance(loop, 1.75, a)).toBe(0.25);
    expect(echoDistance(loop, 1.75, b)).toBe(0.75);
    expect(echoDistance(loop, 1, 'front-hall')).toBeNull();
  });

  it('catch in a dark room within reach, half as far while tiptoeing, never in a lit one', () => {
    const [room] = loop.rooms as [string];
    const lap = loop.periodSeconds * 1000;
    const phases = { [loop.id]: { offset: 0, direction: 1 as const } };
    const near = (loop.reach * 0.75 * lap) / loop.rooms.length; // 0.75 of reach past the room
    const at = (atMs: number, tiptoe = false, lit = new Set<string>()) =>
      echoCatch(house, phases, { room, atMs, tiptoe, lit });
    expect(at(0)).toBe(loop);
    expect(at(near)).toBe(loop);
    expect(at(near, true)).toBeNull();
    expect(at(0, true)).toBe(loop);
    expect(at(lap / 2)).toBeNull();
    expect(at(0, false, new Set([room]))).toBeNull();
    // An echo without a phase this season isn't there.
    expect(echoCatch(house, {}, { room, atMs: 0, tiptoe: false, lit: new Set() })).toBeNull();
  });
});
