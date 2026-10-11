import { describe, expect, it } from 'vitest';
import { HOUSE_DATA } from '../data/house.js';
import {
  HOUSE_START_LEVEL,
  capacityAt,
  houseLevelData,
  maxHouseLevel,
  nextHouseLevel,
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

  it('clamps a level outside the table instead of failing', () => {
    expect(houseLevelData(HOUSE_DATA, 0).level).toBe(1);
    expect(houseLevelData(HOUSE_DATA, 99).level).toBe(maxHouseLevel(HOUSE_DATA));
    expect(capacityAt(HOUSE_DATA, 99)).toBe(capacityAt(HOUSE_DATA, maxHouseLevel(HOUSE_DATA)));
  });
});
