import type { JobSquishy, JobsView, WorkSpot, WorkStatus } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { workableByMe } from './index.js';
import {
  hintLines,
  jobLine,
  nameOf,
  readyTotal,
  spotLabel,
  teamCost,
  teamSlots,
  toggleTeam,
  workLine,
} from './jobs-view.js';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function squishy(n: number, over: Partial<JobSquishy> = {}): JobSquishy {
  return {
    squishy: {
      id: id(n),
      mapId: id(100),
      ownerUserId: id(200),
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
      nickname: null,
      level: 5,
      xp: 0,
      state: 'active',
    },
    job: 'resting',
    teamSlot: null,
    post: null,
    habitatId: null,
    work: null,
    training: null,
    ...over,
  };
}

const work = (over: Partial<WorkStatus> = {}): WorkStatus => ({
  q: 1,
  r: 2,
  resource: 'timber',
  from: 'node',
  cycleSeconds: 1800,
  speedPercent: 100,
  readyCycles: 0,
  ready: {},
  nextReadyAt: new Date(NOW + 12.5 * 60_000).toISOString(),
  full: false,
  firelit: true,
  ...over,
});

describe('job lines', () => {
  it('says what each squishy is doing, kid-readably', () => {
    expect(jobLine(squishy(1), NOW)).toBe('Resting at home 💤');
    expect(jobLine(squishy(1, { habitatId: id(9) }), NOW)).toBe('Resting in a habitat 🏡');
    expect(jobLine(squishy(1, { job: 'team', teamSlot: 1 }), NOW)).toBe('On the team (2nd) ⚔️');
    expect(jobLine(squishy(1, { job: 'guard', post: { q: 0, r: 0 } }), NOW)).toBe('On watch 🛡️');
    const away = squishy(1);
    away.squishy.state = 'hollowed';
    expect(jobLine(away, NOW)).toBe('In the Hollow. You can rescue them!');
  });

  it("shows a gatherer's next ready time and what's waiting", () => {
    expect(workLine(work(), NOW)).toBe('Gathering 🪵 Timber. Next in 12:30.');
    expect(workLine(work({ readyCycles: 1, ready: { timber: 5 } }), NOW)).toBe(
      'Gathering 🪵 Timber. +5 🪵 Timber on its way to your bag! Next in 12:30.',
    );
    expect(workLine(work({ full: true, nextReadyAt: null }), NOW)).toBe(
      'Gathering 🪵 Timber. Basket full! It empties into your bag soon.',
    );
  });

  it('names a squishy by what the server says, else its species', () => {
    const view = { names: { [id(1)]: 'Bubbles' } };
    expect(nameOf(view, squishy(1))).toBe('Bubbles');
    expect(nameOf({ names: {} }, squishy(2))).toBe('Puddlepuff');
  });

  it('shows the trade-offs from data', () => {
    // Water + Silly: both sides of Treats' match, and Puddlepuff's stats lean one way.
    const lines = hintLines(squishy(1));
    expect(lines[0]).toBe('Great at gathering Treats 🍪');
    expect(lines).toHaveLength(2);
    expect(['Strong fighter 💪', 'Speedy fighter ⚡', 'Sturdy guard 🛡️']).toContain(lines[1]);
  });

  it('labels spots by resource and land', () => {
    const spot: WorkSpot = {
      q: 3,
      r: -1,
      terrain: 'forest',
      resource: 'timber',
      from: 'land',
      quantity: 2,
      seconds: 900,
      inSeason: true,
      workerId: null,
      firelit: false,
    };
    expect(spotLabel(spot)).toBe('🪵 Timber on Forest');
    expect(spotLabel({ ...spot, from: 'node' })).toBe('🪵 Timber spot');
  });
});

describe('what’s waiting', () => {
  it('adds up everything waiting', () => {
    const view = {
      squishies: [
        squishy(1, { job: 'gatherer', work: work({ readyCycles: 2, ready: { timber: 10 } }) }),
        squishy(2, {
          job: 'gatherer',
          work: work({ readyCycles: 1, ready: { timber: 5, stone: 2 } }),
        }),
        squishy(3),
      ],
    } satisfies Pick<JobsView, 'squishies'>;
    expect(readyTotal(view)).toEqual({ timber: 15, stone: 2 });
  });
});

describe('team picking', () => {
  it('fills slots in order and takes one off on a second tap', () => {
    let team: string[] = [];
    for (const n of [1, 2, 3, 4]) team = toggleTeam(team, id(n), 3);
    expect(team).toEqual([id(1), id(2), id(3)]);
    team = toggleTeam(team, id(2), 3);
    expect(team).toEqual([id(1), id(3)]);
    expect(teamSlots(team, 3)).toEqual([id(1), id(3), null]);
  });

  it('says what joining costs a guard or a gatherer', () => {
    expect(teamCost(squishy(1))).toBeNull();
    expect(teamCost(squishy(1, { job: 'guard' }))).toBe('Leaves watch');
    expect(teamCost(squishy(1, { job: 'gatherer' }))).toBe('Stops gathering');
  });
});

describe('the tile panel', () => {
  const tile = {
    q: 1,
    r: 1,
    terrain: 'forest',
    ownerUserId: id(200),
    nodeResource: null,
    homeSlot: null,
    gathering: null,
    cooldownUntil: null,
    defenders: 0,
    guardianHint: null,
    buildings: [],
  };

  it('offers a gatherer only on my workable land', () => {
    expect(workableByMe(tile, id(200))).toBe(true);
    expect(workableByMe(tile, id(201))).toBe(false);
    expect(workableByMe(tile, null)).toBe(false);
    expect(workableByMe({ ...tile, terrain: 'lake' }, id(200))).toBe(false);
    expect(workableByMe({ ...tile, homeSlot: 0 }, id(200))).toBe(false);
    expect(workableByMe({ ...tile, homeSlot: 0, nodeResource: 'stone' }, id(200))).toBe(true);
  });
});
