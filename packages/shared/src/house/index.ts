import type { HouseData, HouseLevel, HouseRoom } from '../schemas/data/house.js';

/*
 * Pure house rules (#381). No row in `keeper_houses` reads as level 1: the
 * Snug sprouts with the Heart Seed, free (owner decision 2026-10-11).
 */

/** The level a Keeper with no house row has. */
export const HOUSE_START_LEVEL = 1;

/** The top level in the data. */
export const maxHouseLevel = (data: HouseData): number => data.levels.length;

/**
 * A level's data, clamped into the table, so a level removed from the data
 * reads as the top one rather than failing (as `BUILDING_DATA` clamps).
 */
export function houseLevelData(data: HouseData, level: number): HouseLevel {
  const clamped = Math.min(Math.max(level, HOUSE_START_LEVEL), maxHouseLevel(data));
  const row = data.levels[clamped - 1];
  if (!row) throw new Error('houseLevelData: no house levels');
  return row;
}

/** The level after this one, or null at the top. */
export function nextHouseLevel(data: HouseData, level: number): HouseLevel | null {
  return level >= maxHouseLevel(data) ? null : houseLevelData(data, level + 1);
}

/** Every room a house at this level has, in the order they were added. */
export function roomsAt(data: HouseData, level: number): HouseRoom[] {
  const top = houseLevelData(data, level).level;
  return data.levels.filter((l) => l.level <= top).map((l) => l.room);
}

/** Beds across every room at this level. */
export function capacityAt(data: HouseData, level: number): number {
  return roomsAt(data, level).reduce((sum, room) => sum + room.beds, 0);
}
