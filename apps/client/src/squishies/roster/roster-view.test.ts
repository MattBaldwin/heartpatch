import type {
  CareListResponse,
  CareSquishy,
  HomeResponse,
  HomeSquishy,
  JobSquishy,
  JobsView,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  evolutionStage,
  filterCounts,
  heartsOf,
  mergeRoster,
  needsCare,
  ROSTER_TEXT,
  statusLine,
  statusTag,
  visibleRows,
  type RosterRow,
} from './roster-view.js';

const NOW = '2026-10-11T12:00:00.000Z';
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function homeSquishy(n: number, over: Partial<HomeSquishy> = {}): HomeSquishy {
  return {
    id: id(n),
    speciesId: 'puddlepuff',
    element: 'water',
    feeling: 'silly',
    nickname: null,
    level: 5,
    habitatId: null,
    trainingId: null,
    job: 'resting',
    accessory: null,
    ...over,
  };
}

function careSquishy(n: number, over: Partial<CareSquishy> = {}): CareSquishy {
  return {
    id: id(n),
    speciesId: 'puddlepuff',
    element: 'water',
    feeling: 'silly',
    nickname: null,
    level: 5,
    xp: 100,
    xpIntoLevel: 10,
    xpToNext: 50,
    evolving: { percent: 40, levelsToGo: 11 },
    stats: { hp: 10, attack: 10, defense: 10, speed: 10 },
    contentment: 50,
    mood: 'calm',
    moodDrift: 'resting',
    xpBonusPercent: 100,
    habitatId: null,
    caredToday: 0,
    fullCareLeft: 3,
    nextCareAt: {},
    newEvolution: null,
    whisper: null,
    accessory: null,
    ...over,
  };
}

function jobSquishy(n: number, over: Partial<JobSquishy> = {}): JobSquishy {
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
    fullXpResetAt: null,
    gatherFits: [],
    ...over,
  };
}

function home(squishies: HomeSquishy[]): HomeResponse {
  return {
    tiles: [],
    buildings: [],
    squishies,
    speciesDefs: [],
    items: {},
    seasons: [],
    tonight: '2026-10-11',
    now: NOW,
  };
}

function care(squishies: CareSquishy[]): CareListResponse {
  return { squishies, speciesDefs: [], items: {}, coinsToday: 0, now: NOW };
}

function jobs(squishies: JobSquishy[]): JobsView {
  return {
    squishies,
    names: {},
    team: [],
    spots: [],
    trainingGrounds: [],
    rules: { teamSize: 3, maxStoredCycles: 4 },
    now: NOW,
  };
}

describe('mergeRoster', () => {
  it('joins home, care and jobs by id, with the away ones only the job board knows', () => {
    const rows = mergeRoster({
      home: home([
        homeSquishy(1, { nickname: 'Mochi' }),
        homeSquishy(2, { speciesId: 'emberbun' }),
      ]),
      care: care([
        careSquishy(1, { nickname: 'Mochi', contentment: 90, mood: 'glowing', fullCareLeft: 0 }),
        careSquishy(2, { speciesId: 'emberbun', contentment: 30 }),
      ]),
      jobs: jobs([
        jobSquishy(1, { job: 'team' }),
        jobSquishy(2),
        jobSquishy(3, {
          squishy: { ...jobSquishy(3).squishy, speciesId: 'gourdon', state: 'hollowed' },
        }),
      ]),
    });
    expect(rows.map((r) => r.id)).toEqual([id(1), id(2), id(3)]);
    const [mochi, ember, away] = rows as [RosterRow, RosterRow, RosterRow];
    expect(mochi.name).toBe('Mochi');
    expect(mochi.status.kind).toBe('team');
    expect(mochi.mood).toMatchObject({ mood: 'glowing', contentment: 90, needsCare: false });
    expect(ember.name).toBe('Emberbun');
    expect(ember.mood?.needsCare).toBe(true);
    expect(ember.mood?.drift).toBe('resting');
    expect(away.status.kind).toBe('hollowed');
    expect(away.away).toBe(true);
    expect(away.mood).toBeNull();
    expect(away.stage).toBeNull();
    expect(away.job).toBeNull();
  });

  it('leaves the tags off when a read is missing', () => {
    const [row] = mergeRoster({ home: home([homeSquishy(1)]), care: null, jobs: null });
    expect(row?.mood).toBeNull();
    expect(row?.stage).toBeNull();
    expect(row?.status.kind).toBe('resting');
  });

  it('passes the whisper through for the detail only', () => {
    const whisper = { icon: '🌧️', text: 'Rainy days make it dreamy…' };
    const [row] = mergeRoster({
      home: home([homeSquishy(1)]),
      care: care([careSquishy(1, { whisper })]),
      jobs: null,
    });
    expect(row?.whisper).toEqual(whisper);
  });
});

describe('evolutionStage', () => {
  it('counts the public line: a first form is stage 1 of 2, evolving at its level', () => {
    expect(evolutionStage('puddlepuff', 5, { percent: 40, levelsToGo: 11 })).toEqual({
      stage: 1,
      of: 2,
      evolvesAt: 16,
      fill: 0.4,
      ready: false,
    });
  });

  it('says ready at 100%', () => {
    expect(evolutionStage('puddlepuff', 16, { percent: 100, levelsToGo: 0 })).toMatchObject({
      evolvesAt: null,
      ready: true,
      fill: 1,
    });
  });

  it('puts an evolved form on its last stage, with no bar', () => {
    expect(evolutionStage('splashmallow', 20, null)).toEqual({
      stage: 2,
      of: 2,
      evolvesAt: null,
      fill: null,
      ready: false,
    });
  });

  it('says nothing about a form off the public lines (rule 6)', () => {
    expect(evolutionStage('not-a-public-form', 10, null)).toBeNull();
  });
});

describe('needsCare', () => {
  it('is due below Happy while a cuddle still counts in full', () => {
    expect(needsCare({ contentment: 39, fullCareLeft: 1 })).toBe(true);
    expect(needsCare({ contentment: 5, fullCareLeft: 3 })).toBe(true);
  });

  it("never shows on a Happy or Glowing one, or once today's full cuddles are used", () => {
    expect(needsCare({ contentment: 40, fullCareLeft: 3 })).toBe(false);
    expect(needsCare({ contentment: 90, fullCareLeft: 3 })).toBe(false);
    expect(needsCare({ contentment: 10, fullCareLeft: 0 })).toBe(false);
  });
});

describe('heartsOf', () => {
  it('rounds contentment to the nearest half heart out of 5', () => {
    expect(heartsOf(0)).toBe(0);
    expect(heartsOf(100)).toBe(5);
    expect(heartsOf(50)).toBe(2.5);
    expect(heartsOf(74)).toBe(3.5);
    expect(heartsOf(76)).toBe(4);
  });
});

describe('statusTag and statusLine', () => {
  it('counts a gatherer down to its next basket', () => {
    const tag = statusTag(
      jobSquishy(1, {
        job: 'gatherer',
        work: {
          q: 1,
          r: 0,
          resource: 'timber',
          from: 'node',
          cycleSeconds: 900,
          speedPercent: 100,
          readyCycles: 0,
          ready: {},
          nextReadyAt: '2026-10-11T12:05:00.000Z',
          full: false,
          firelit: true,
        },
      }),
      null,
    );
    expect(tag.kind).toBe('gathering');
    expect(statusLine(tag, Date.parse(NOW))).toMatch(/^Gathering .+ · 5:00$/);
    expect(statusLine(tag, Date.parse('2026-10-11T12:06:00.000Z'))).toBe(tag.text);
  });

  it('marks a squishy in a trade as away', () => {
    const tag = statusTag(
      jobSquishy(1, { squishy: { ...jobSquishy(1).squishy, state: 'in-trade' } }),
      null,
    );
    expect(tag).toEqual({ kind: 'in-trade', text: ROSTER_TEXT.inTrade, readyAt: null });
  });
});

describe('visibleRows and filterCounts', () => {
  const rows = mergeRoster({
    home: home([
      homeSquishy(1, { nickname: 'Ada', level: 9 }),
      homeSquishy(2, { nickname: 'Bo', level: 14, speciesId: 'thunderpuff' }),
      homeSquishy(3, { nickname: 'Cy', level: 3 }),
    ]),
    care: care([
      careSquishy(1, { nickname: 'Ada', level: 9, contentment: 80, fullCareLeft: 0 }),
      careSquishy(2, { nickname: 'Bo', level: 14, contentment: 20, speciesId: 'thunderpuff' }),
      careSquishy(3, { nickname: 'Cy', level: 3, contentment: 50 }),
    ]),
    jobs: jobs([jobSquishy(1, { job: 'team' }), jobSquishy(2, { job: 'training' }), jobSquishy(3)]),
  });
  const names = (rs: readonly RosterRow[]) => rs.map((r) => r.name);

  it('sorts neediest first, highest level or rarity first, and by job', () => {
    expect(names(visibleRows(rows, 'mood', 'all'))).toEqual(['Bo', 'Cy', 'Ada']);
    expect(names(visibleRows(rows, 'level', 'all'))).toEqual(['Bo', 'Ada', 'Cy']);
    expect(names(visibleRows(rows, 'rarity', 'all'))[0]).toBe('Bo');
    expect(names(visibleRows(rows, 'status', 'all'))).toEqual(['Ada', 'Bo', 'Cy']);
  });

  it('filters needs care, on team and working, and counts each', () => {
    expect(names(visibleRows(rows, 'mood', 'care'))).toEqual(['Bo']);
    expect(names(visibleRows(rows, 'mood', 'team'))).toEqual(['Ada']);
    expect(names(visibleRows(rows, 'mood', 'working'))).toEqual(['Bo']);
    expect(filterCounts(rows)).toEqual({ all: 3, care: 1, team: 1, working: 1 });
  });

  it('sorts 300 squishies quickly', () => {
    const many = Array.from({ length: 300 }, (_, i) => rows[i % 3]!).map((r, i) => ({
      ...r,
      id: id(1000 + i),
    }));
    const start = performance.now();
    for (const sort of ['mood', 'level', 'rarity', 'status'] as const)
      visibleRows(many, sort, 'all');
    expect(performance.now() - start).toBeLessThan(100);
  });
});
