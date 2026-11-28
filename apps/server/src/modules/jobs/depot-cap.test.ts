import { GAME_DATA, JOB_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { holdFactsOf } from './contentment.js';
import type { JobRow } from './repo.js';
import { workAt, workCapOf } from './work.js';

// A Rail Depot's cap (#874) is one number every reader agrees on: what a
// gatherer holds (`workAt`) and when its contentment stops holding
// (`holdFactsOf`). Pure: hand-built job rows, no database.

const SINCE = new Date('2026-11-28T12:00:00Z');
const MAP = { id: 'map', kind: 'multiplayer' as const, timeZone: 'America/Denver' };
const DEPOT = GAME_DATA.buildings.find((b) => b.id === 'rail-depot');
const waitingAt = (level: number) =>
  DEPOT?.kind === 'depot' ? DEPOT.levels[level - 1]!.waitingCycles : 0;

/** A Timber gatherer on far forest land with a rail; `depotLevel` from its rail line. */
function gatherer(depotLevel: number | null): JobRow {
  return {
    squishy: {
      id: 'pet',
      mapId: 'map',
      ownerUserId: 'kid',
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
      nickname: null,
      level: 5,
      xp: 0,
      state: 'active',
    },
    habitatBuildingId: null,
    teamSlot: null,
    workTile: {
      id: 'tile',
      q: 5,
      r: 0,
      terrain: 'forest',
      nodeResource: null,
      homeSlot: null,
      ownerUserId: 'kid',
      homestead: null,
      roadLevel: null,
      railLevel: 1,
      depotLevel,
    },
    workSince: SINCE,
    workStartedAt: SINCE,
    atWork: true,
    lostAt: null,
    post: null,
    onWatch: false,
    training: null,
    care: {
      contentment: 50,
      contentmentSince: SINCE,
      contentmentAtLastCare: 50,
      lastCaredAt: null,
    },
    houseRoomId: null,
  };
}

describe('the Rail Depot cap (#874)', () => {
  it('raises the cap to the joined Depot level’s waitingCycles, and only then', () => {
    expect(workCapOf({ depotLevel: null })).toEqual({
      maxStoredCycles: JOB_RULES.work.maxStoredCycles,
      depot: false,
    });
    expect(workCapOf({ depotLevel: 1 })).toEqual({ maxStoredCycles: waitingAt(1), depot: true });
    expect(workCapOf({ depotLevel: 2 })).toEqual({ maxStoredCycles: waitingAt(2), depot: true });
  });

  it.each([
    [null, JOB_RULES.work.maxStoredCycles],
    [1, waitingAt(1)],
    [2, waitingAt(2)],
  ])('depot level %s: holds %i cycles, and contentment holds until then', (level, cap) => {
    const row = gatherer(level);
    const cycleMs = workAt(row, MAP, SINCE)!.cycleSeconds * 1000;
    const later = new Date(SINCE.getTime() + cycleMs * (waitingAt(2) + 10));
    expect(workAt(row, MAP, later)!.progress).toMatchObject({ cycles: cap, full: true });
    const facts = holdFactsOf(row, MAP, later, SINCE);
    expect(facts.gatherer?.fullMs).toBe(SINCE.getTime() + cycleMs * cap);
  });
});
