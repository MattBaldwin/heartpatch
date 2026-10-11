import { describe, expect, it } from 'vitest';
import { checkHouseData, type HouseData, type HouseDataRefs } from '../schemas/data/house.js';
import { HOUSE_DATA } from './house.js';
import { GAME_DATA } from './index.js';
import { MILESTONE_TRACKS } from './milestones.js';

const refs: HouseDataRefs = {
  buildings: GAME_DATA.buildings,
  resources: GAME_DATA.resources,
  milestoneTrackIds: MILESTONE_TRACKS.map((t) => t.id),
};

/** A deep copy to break. */
const copy = (): HouseData => structuredClone(HOUSE_DATA);

describe('HOUSE_DATA (#381)', () => {
  it('passes its checks', () => {
    expect(checkHouseData(HOUSE_DATA, refs)).toEqual([]);
  });

  it('caps every level from 2 by the Heart Seed (owner decision 2026-10-11)', () => {
    for (const level of HOUSE_DATA.levels.slice(1)) {
      expect(level.requirements[0]).toMatchObject({ kind: 'heartSeedLevel' });
    }
  });

  it('makes the final level plainly the hardest (owner: "so hard to get to")', () => {
    const counts = HOUSE_DATA.levels.map((l) => l.requirements.length);
    expect(Math.max(...counts)).toBe(counts.at(-1));
  });

  it('refuses a gap in levels, a cost on level 1 and a level with no Seed cap', () => {
    const broken = copy();
    const [first, second, third] = broken.levels;
    if (!first || !second || !third) throw new Error('fixture');
    first.cost = { timber: 1 };
    second.requirements = second.requirements.filter((r) => r.kind !== 'heartSeedLevel');
    third.level = 7;
    expect(checkHouseData(broken, refs)).toEqual([
      'levels[0]: level 1 is free',
      'levels[1]: needs a heartSeedLevel requirement (the Seed is the cap)',
      'levels[2]: level 7 should be 3',
    ]);
  });

  it('refuses overlapping rooms, a floating room and a duplicate room id', () => {
    const broken = copy();
    const [, second, third, fourth] = broken.levels;
    if (!second || !third || !fourth) throw new Error('fixture');
    second.room.layout = { ...second.room.layout, gx: 1 };
    third.room.layout = { ...third.room.layout, gx: 9 };
    fourth.room.id = 'snug';
    expect(checkHouseData(broken, refs)).toEqual([
      'levels[1]: room "playroom" overlaps "snug"',
      'levels[2]: room "kitchen" has nothing under it',
      'levels[3]: duplicate room id "snug"',
    ]);
  });

  it('refuses unknown content and an avoided word', () => {
    const broken = copy();
    const [, second] = broken.levels;
    if (!second) throw new Error('fixture');
    second.cost = { unobtainium: 1 };
    second.requirements.push(
      { kind: 'buildingsBuilt', buildingId: 'moon-base', count: 1 },
      { kind: 'milestonesReached', trackId: 'nope', count: 1 },
    );
    second.room.description = 'No enemy gets in here.';
    expect(checkHouseData(broken, refs)).toEqual([
      'levels[1].cost: unknown resource "unobtainium"',
      'levels[1].requirements[5]: unknown building "moon-base"',
      'levels[1].requirements[6]: unknown milestone track "nope"',
      'house.levels[1].room.description: "enemy"',
    ]);
  });

  it('refuses a second final level', () => {
    const broken = copy();
    const [, second] = broken.levels;
    if (!second) throw new Error('fixture');
    second.final = true;
    expect(checkHouseData(broken, refs)).toEqual(['levels[1]: only the last level is final']);
  });
});
