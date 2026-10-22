import {
  findAvoidedWords,
  GAME_DATA,
  type JobSquishy,
  type JobsView,
  type WorkSpot,
  type WorkStatus,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { itemName } from '../../inventory/bag-view.js';
import { itemIcon } from '../../inventory/item-icons.js';
import { workableByMe } from './index.js';
import {
  canTrain,
  groundsLabel,
  trainHintText,
  hintLines,
  countsDown,
  jobLine,
  JOBS_TEXT,
  gathererMark,
  workerLine,
  nameOf,
  rarityOf,
  readyTotal,
  spotFit,
  workMood,
  spotLabel,
  teamCost,
  teamSlots,
  toggleTeam,
  workLine,
  workMoods,
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
    fullXpResetAt: null,
    gatherFits: [],
    houseRoomId: null,
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

describe('full XP again (#201)', () => {
  it('says when a squishy past its full-XP wins gets full XP again', () => {
    const tired = squishy(1, {
      job: 'team',
      teamSlot: 0,
      fullXpResetAt: new Date(NOW + 5 * 3_600_000).toISOString(),
    });
    expect(jobLine(tired, NOW)).toBe('On the team (1st) ⚔️ · Full XP again in 5h');
    // Once it's back, the line is just the job (the board asks for a fresh view).
    expect(jobLine(tired, NOW + 5 * 3_600_000)).toBe('On the team (1st) ⚔️');
    expect(jobLine(squishy(2, { job: 'team', teamSlot: 1 }), NOW)).toBe('On the team (2nd) ⚔️');
  });

  it('ticks on the board, so the note counts down and the board asks again at zero', () => {
    const at = new Date(NOW + 3_600_000).toISOString();
    expect(countsDown(squishy(1, { job: 'team', teamSlot: 0, fullXpResetAt: at }))).toBe(true);
    expect(countsDown(squishy(1, { fullXpResetAt: at }))).toBe(true);
    expect(countsDown(squishy(1, { job: 'team', teamSlot: 0 }))).toBe(false);
  });
});

describe('job lines', () => {
  it('says what each squishy is doing, kid-readably', () => {
    expect(jobLine(squishy(1), NOW)).toBe('Resting at home 💤');
    expect(jobLine(squishy(1, { habitatId: id(9) }), NOW)).toBe('Resting in a habitat 🏡');
    expect(jobLine(squishy(1, { job: 'team', teamSlot: 1 }), NOW)).toBe('On the team (2nd) ⚔️');
    expect(jobLine(squishy(1, { job: 'training' }), NOW)).toBe(
      'Practicing at the Training Grounds 🎯',
    );
    expect(teamCost(squishy(1, { job: 'training' }))).toBe('Stops training');
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
    // Water + Silly: both sides of Water's match (#238), and Puddlepuff's stats lean one way.
    const lines = hintLines(squishy(1));
    expect(lines[0]).toBe('Great at gathering Water 💧');
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
    // Lakes give Water to a gatherer now (#238); Juniper's Gap land gives nothing.
    expect(workableByMe({ ...tile, terrain: 'lake' }, id(200))).toBe(true);
    expect(workableByMe({ ...tile, terrain: 'junipers-gap' }, id(200))).toBe(false);
    expect(workableByMe({ ...tile, homeSlot: 0 }, id(200))).toBe(false);
    expect(workableByMe({ ...tile, homeSlot: 0, nodeResource: 'stone' }, id(200))).toBe(true);
  });
});

describe('rarityOf (#240)', () => {
  it("gives a squishy's species rarity for its dot on the team picker", () => {
    expect(rarityOf(squishy(1))).toBe('common');
    const epic = GAME_DATA.species.find((s) => s.rarity === 'epic');
    if (!epic) throw new Error('no epic species');
    const s = squishy(2);
    expect(rarityOf({ ...s, squishy: { ...s.squishy, speciesId: epic.id } })).toBe('epic');
  });

  it('shows no dot for a species this client has no row for', () => {
    const s = squishy(3);
    expect(rarityOf({ ...s, squishy: { ...s.squishy, speciesId: 'secret-thing' } })).toBeNull();
  });
});

describe('Training Grounds on homesteads (#277)', () => {
  const g = (n: number, used: number, napping = false) => ({
    id: id(n),
    q: n,
    r: 0,
    capacity: 2,
    used,
    firelit: false,
    napping,
  });

  it('labels each one with its room, numbered when there are more', () => {
    expect(groundsLabel({ trainingGrounds: [g(1, 1)] }, id(1))).toBe(
      '🎯 Training Grounds · room for 1',
    );
    const two = { trainingGrounds: [g(1, 2), g(2, 0)] };
    expect(groundsLabel(two, id(1))).toBe('🎯 Training Grounds 1 · full');
    expect(groundsLabel(two, id(2))).toBe('🎯 Training Grounds 2 · room for 2');
  });

  it('can train only where there is room and the homestead is awake', () => {
    expect(canTrain({ trainingGrounds: [] })).toBe(false);
    expect(canTrain({ trainingGrounds: [g(1, 2)] })).toBe(false);
    expect(canTrain({ trainingGrounds: [g(1, 0, true)] })).toBe(false);
    expect(canTrain({ trainingGrounds: [g(1, 2), g(2, 1)] })).toBe(true);
  });

  it('says why Train is off: none yet, all napping, or all full', () => {
    expect(trainHintText({ trainingGrounds: [] })).toBe(JOBS_TEXT.noGrounds);
    expect(trainHintText({ trainingGrounds: [g(1, 0, true)] })).toBe(JOBS_TEXT.allNapping);
    expect(trainHintText({ trainingGrounds: [g(1, 2)] })).toBe(JOBS_TEXT.groundsFull);
    expect(trainHintText({ trainingGrounds: [g(1, 2), g(2, 0, true)] })).toBe(
      JOBS_TEXT.groundsFull,
    );
    expect(trainHintText({ trainingGrounds: [g(1, 1)] })).toBe('');
  });
});

describe('spot fit (#376)', () => {
  it('says it loves a resource it is good at, and warns about one it is not', () => {
    const pet = squishy(1, { gatherFits: ['timber'] });
    expect(spotFit(pet, { resource: 'timber' })).toEqual({
      fits: true,
      line: `Loves gathering ${itemName('timber')} here! ${itemIcon('timber')}`,
    });
    expect(spotFit(pet, { resource: 'stone' })).toEqual({
      fits: false,
      line: JOBS_TEXT.noFit,
    });
  });
});

describe('work mood (#376)', () => {
  it('loves the team, a watch, training and a resource it is good at', () => {
    for (const job of ['team', 'guard'] as const) {
      expect(workMood(squishy(1, { job }))).toBe('loves');
    }
    const practicing = (over: { full?: boolean; napping?: boolean } = {}) =>
      ({ full: false, napping: false, ...over }) as NonNullable<JobSquishy['training']>;
    expect(workMood(squishy(1, { job: 'training', training: practicing() }))).toBe('loves');
    expect(
      workMood(squishy(1, { job: 'training', training: practicing({ full: true }) })),
    ).toBeNull();
    expect(
      workMood(squishy(1, { job: 'training', training: practicing({ napping: true }) })),
    ).toBeNull();
    expect(
      workMood(
        squishy(1, { job: 'gatherer', gatherFits: ['timber'], work: work({ resource: 'timber' }) }),
      ),
    ).toBe('loves');
  });

  it('is meh about a resource it is not good at, and says nothing while resting', () => {
    expect(
      workMood(
        squishy(1, { job: 'gatherer', gatherFits: ['timber'], work: work({ resource: 'stone' }) }),
      ),
    ).toBe('meh');
    expect(workMood(squishy(1, { job: 'resting' }))).toBeNull();
  });

  it('says nothing while a job it loves has stopped (its happiness drifts then)', () => {
    expect(
      workMood(
        squishy(1, {
          job: 'gatherer',
          gatherFits: ['timber'],
          work: work({ resource: 'timber', full: true }),
        }),
      ),
    ).toBeNull();
    // A wrong resource stays meh, full or not.
    expect(
      workMood(
        squishy(1, {
          job: 'gatherer',
          gatherFits: ['timber'],
          work: work({ resource: 'stone', full: true }),
        }),
      ),
    ).toBe('meh');
  });
});

describe('job moods on the map and at home (#393)', () => {
  const loves = squishy(1, { job: 'gatherer', gatherFits: ['timber'], work: work() });
  const meh = squishy(2, {
    job: 'gatherer',
    gatherFits: [],
    work: work({ q: 3, r: 4, resource: 'stone' }),
  });
  const full = squishy(3, {
    job: 'gatherer',
    gatherFits: ['timber'],
    work: work({ q: 5, r: 6, full: true }),
  });

  it('gives each of my squishies with a mood its mood, and leaves the rest out', () => {
    const moods = workMoods({
      squishies: [loves, meh, full, squishy(4, { job: 'team' }), squishy(5)],
    });
    expect([...moods]).toEqual([
      [id(1), 'loves'],
      [id(2), 'meh'],
      [id(4), 'loves'],
    ]);
  });

  it('marks only my gatherers that need me: not keen, or napping (#602)', () => {
    const open = { homestead: null };
    expect(gathererMark(loves, open)).toBeNull();
    expect(gathererMark(meh, open)).toBe('meh');
    expect(gathererMark(full, open)).toBe('napping');
    // A homestead cut off from home naps its gatherer, however happy.
    expect(gathererMark(loves, { homestead: 'paused' })).toBe('napping');
    // Not keen beats napping: it's the one a kid can fix by moving it.
    const mehFull = squishy(6, { job: 'gatherer', gatherFits: [], work: work({ full: true }) });
    expect(gathererMark(mehFull, open)).toBe('meh');
    expect(gathererMark(squishy(4, { job: 'team' }), open)).toBeNull();
  });

  it("says who gathers here: mine by name and mood, a patch-mate's never which (#602)", () => {
    const open = { homestead: null };
    expect(workerLine(1, null, open)).toBe(JOBS_TEXT.gatheringHere(1));
    expect(workerLine(1, { name: 'Pip', squishy: loves }, open)).toBe(JOBS_TEXT.workerLoves('Pip'));
    expect(workerLine(1, { name: 'Pip', squishy: meh }, open)).toBe(JOBS_TEXT.workerMeh('Pip'));
    expect(workerLine(1, { name: 'Pip', squishy: full }, open)).toBe(JOBS_TEXT.workerFull('Pip'));
    expect(workerLine(1, { name: 'Pip', squishy: loves }, { homestead: 'paused' })).toBe(
      JOBS_TEXT.workerPaused('Pip'),
    );
    // Napping and not keen: the line says both, as the map's 🌧️ mark does.
    const mehFull = squishy(7, { job: 'gatherer', gatherFits: [], work: work({ full: true }) });
    expect(gathererMark(mehFull, open)).toBe('meh');
    expect(workerLine(1, { name: 'Pip', squishy: mehFull }, open)).toBe(
      `${JOBS_TEXT.workerFull('Pip')} ${JOBS_TEXT.workerNotKeen}`,
    );
    expect(gathererMark(meh, { homestead: 'paused' })).toBe('meh');
    expect(workerLine(1, { name: 'Pip', squishy: meh }, { homestead: 'paused' })).toBe(
      `${JOBS_TEXT.workerPaused('Pip')} ${JOBS_TEXT.workerNotKeen}`,
    );
    // Whatever the mark says, the line says too.
    for (const s of [loves, meh, full, mehFull]) {
      for (const tile of [open, { homestead: 'paused' as const }]) {
        const line = workerLine(1, { name: 'Pip', squishy: s }, tile);
        const mark = gathererMark(s, tile);
        if (mark === 'meh') expect(line).toContain('🌧️');
        if (mark === 'napping') expect(line).toContain('💤');
      }
    }
    for (const line of [
      JOBS_TEXT.workerHere('Pip'),
      JOBS_TEXT.workerLoves('Pip'),
      JOBS_TEXT.workerMeh('Pip'),
      JOBS_TEXT.workerFull('Pip'),
      JOBS_TEXT.workerPaused('Pip'),
      JOBS_TEXT.workerNotKeen,
      workerLine(1, { name: 'Pip', squishy: mehFull }, open),
      workerLine(1, { name: 'Pip', squishy: meh }, { homestead: 'paused' }),
    ]) {
      expect(findAvoidedWords(line)).toEqual([]);
    }
  });
});
