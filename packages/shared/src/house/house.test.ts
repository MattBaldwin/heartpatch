import { describe, expect, it } from 'vitest';
import { HOUSE_DATA } from '../data/house.js';
import type { HouseRules } from '../schemas/data/house.js';
import {
  HOUSE_START_LEVEL,
  capacityAt,
  houseLevelData,
  maxHouseLevel,
  moveBackInAt,
  moveInProblem,
  nextHouseLevel,
  residentAwayOf,
  residentDrainPercent,
  roomsAt,
} from './index.js';

describe('house rules (#381)', () => {
  it('starts everyone at level 1 with the Snug, free', () => {
    expect(HOUSE_START_LEVEL).toBe(1);
    const first = houseLevelData(HOUSE_DATA, HOUSE_START_LEVEL);
    expect(first.room.id).toBe('snug');
    expect(first.cost).toEqual({});
    expect(first.requirements).toEqual([]);
  });

  it('adds one room per level and counts beds across them (plan Q1: 2, 4, 6, 10)', () => {
    expect(roomsAt(HOUSE_DATA, 1).map((r) => r.id)).toEqual(['snug']);
    expect(roomsAt(HOUSE_DATA, 3).map((r) => r.id)).toEqual(['snug', 'playroom', 'kitchen']);
    expect([1, 2, 3, 4].map((l) => capacityAt(HOUSE_DATA, l))).toEqual([2, 4, 6, 10]);
  });

  it('has a next level until the top, and the top is final', () => {
    expect(nextHouseLevel(HOUSE_DATA, 1)?.level).toBe(2);
    const top = maxHouseLevel(HOUSE_DATA);
    expect(nextHouseLevel(HOUSE_DATA, top)).toBeNull();
    expect(houseLevelData(HOUSE_DATA, top).final).toBe(true);
  });

  it('gives residents the perk from data, and swaps by data (plan Q2)', () => {
    expect(residentDrainPercent(HOUSE_DATA.rules, true)).toBe(50);
    expect(residentDrainPercent(HOUSE_DATA.rules, false)).toBe(100);
    const careBonus: HouseRules = {
      ...HOUSE_DATA.rules,
      perk: { kind: 'care-bonus', extraFullActions: 1 },
    };
    expect(residentDrainPercent(careBonus, true)).toBe(100);
  });

  it('lets a squishy move back in 24 h after it moved out', () => {
    const out = new Date('2026-10-12T08:00:00Z');
    expect(moveBackInAt(out, HOUSE_DATA.rules).toISOString()).toBe('2026-10-13T08:00:00.000Z');
  });

  it('says why a resident is away from its bed', () => {
    expect(residentAwayOf('hollowed', 'gatherer')).toBe('hollow');
    expect(residentAwayOf('in-trade', 'resting')).toBe('in-trade');
    expect(residentAwayOf('active', 'gatherer')).toBe('gathering');
    expect(residentAwayOf('active', 'guard')).toBe('guarding');
    expect(residentAwayOf('active', 'training')).toBe('training');
    expect(residentAwayOf('active', 'team')).toBeNull();
    expect(residentAwayOf('active', 'resting')).toBeNull();
  });

  describe('moveInProblem', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const ok = {
      state: 'active' as const,
      room: { beds: 2 },
      inRoom: 1,
      movingRooms: false,
      movedOutAt: null,
      now,
    };
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

    it('lets an active squishy into a room with a free bed', () => {
      expect(moveInProblem(ok, HOUSE_DATA.rules)).toBeNull();
    });

    it('refuses one at a trading post, in the Hollow, or for a room not built', () => {
      expect(moveInProblem({ ...ok, state: 'in-trade' }, HOUSE_DATA.rules)).toBe('in-trade');
      expect(moveInProblem({ ...ok, state: 'hollowed' }, HOUSE_DATA.rules)).toBe('hollowed');
      expect(moveInProblem({ ...ok, room: null }, HOUSE_DATA.rules)).toBe('no-room');
    });

    it('refuses a full room, and one tuned below its residents, without evicting', () => {
      expect(moveInProblem({ ...ok, inRoom: 2 }, HOUSE_DATA.rules)).toBe('full');
      expect(moveInProblem({ ...ok, inRoom: 3 }, HOUSE_DATA.rules)).toBe('full');
    });

    it('holds a move back in for 24 h, but not a move between rooms', () => {
      expect(moveInProblem({ ...ok, movedOutAt: hoursAgo(23) }, HOUSE_DATA.rules)).toBe('cooldown');
      expect(moveInProblem({ ...ok, movedOutAt: hoursAgo(24) }, HOUSE_DATA.rules)).toBeNull();
      expect(
        moveInProblem({ ...ok, movedOutAt: hoursAgo(1), movingRooms: true }, HOUSE_DATA.rules),
      ).toBeNull();
    });
  });

  it('clamps a level outside the table instead of failing', () => {
    expect(houseLevelData(HOUSE_DATA, 0).level).toBe(1);
    expect(houseLevelData(HOUSE_DATA, 99).level).toBe(maxHouseLevel(HOUSE_DATA));
    expect(capacityAt(HOUSE_DATA, 99)).toBe(capacityAt(HOUSE_DATA, maxHouseLevel(HOUSE_DATA)));
  });
});
