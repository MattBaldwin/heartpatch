import { describe, expect, it } from 'vitest';
import { BATTLE_RULES } from '../data/battle.js';
import { GAME_DATA } from '../data/index.js';
import { JOB_RULES } from '../data/jobs.js';
import { checkJobRules, type JobRules } from '../schemas/data/jobs.js';
import {
  affinityMatches,
  jobHints,
  jobHintText,
  jobOf,
  teamProblem,
  trainingProgress,
  workCycleSeconds,
  workProgress,
  workSource,
  workSpeedModifiers,
  workSpeedPercent,
  combinePercents,
  workYield,
} from './index.js';

const { resources } = GAME_DATA;
const HALLOWEEN = new Set(['halloween']);
const NO_SEASON = new Set<string>();
const MINUTE = 60_000;

describe('job rules data', () => {
  it('passes its own checks', () => {
    expect(checkJobRules(JOB_RULES, GAME_DATA)).toEqual([]);
  });

  it('names real terrains and gathered resources, once each', () => {
    const broken: JobRules = {
      ...JOB_RULES,
      terrainYields: [
        { terrain: 'moon', resource: 'timber', quantity: 1, seconds: 60 },
        { terrain: 'forest', resource: 'heart-charm', quantity: 1, seconds: 60 },
        { terrain: 'forest', resource: 'timber', quantity: 1, seconds: 60 },
      ],
      affinities: [
        { resource: 'timber', icon: '🌲', elements: [], feelings: [], seasons: ['spring'] },
        { resource: 'timber', icon: '🌲', elements: [], feelings: [], seasons: [] },
      ],
    };
    expect(checkJobRules(broken, GAME_DATA)).toEqual([
      'terrainYields[0]: unknown terrain',
      "terrainYields[1]: heart-charm isn't a gathered resource",
      'terrainYields[2]: forest has two yields',
      'affinities[0]: unknown season spring',
      'affinities[1]: timber is listed twice',
    ]);
  });

  it('keeps a double match at least as quick as a single one', () => {
    const slow = {
      ...JOB_RULES,
      work: { ...JOB_RULES.work, match: { onePercent: 175, bothPercent: 135 } },
    };
    expect(checkJobRules(slow, GAME_DATA)).not.toEqual([]);
  });
});

describe('one job at a time', () => {
  it('reads one job from the stored facts', () => {
    const none = { teamSlot: null, atWork: false, onWatch: false, training: false };
    expect(jobOf(none)).toBe('resting');
    expect(jobOf({ ...none, teamSlot: 0 })).toBe('team');
    expect(jobOf({ ...none, atWork: true })).toBe('gatherer');
    expect(jobOf({ ...none, onWatch: true })).toBe('guard');
    expect(jobOf({ ...none, training: true })).toBe('training');
    // A watch post is what nightfall and the map count, so it wins a stale row.
    expect(jobOf({ teamSlot: 1, atWork: true, onWatch: true, training: true })).toBe('guard');
  });

  it('keeps a team within the team size, each squishy once', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'];
    expect(teamProblem([], BATTLE_RULES)).toBeNull();
    expect(teamProblem([a, b, c], BATTLE_RULES)).toBeNull();
    expect(teamProblem([a, b, c, d], BATTLE_RULES)).toBe('A team has room for 3 squishies.');
    expect(teamProblem([a, a], BATTLE_RULES)).toBe('Each squishy can only go once!');
  });
});

describe('what a gatherer works', () => {
  it('works a node first, then the land outside the home base', () => {
    expect(
      workSource({ terrain: 'meadow', nodeResource: 'timber', homeSlot: 0 }, resources, JOB_RULES),
    ).toEqual({ resource: 'timber', quantity: 5, seconds: 900, from: 'node' });
    expect(
      workSource({ terrain: 'forest', nodeResource: null, homeSlot: null }, resources, JOB_RULES),
    ).toEqual({ resource: 'timber', quantity: 2, seconds: 900, from: 'land' });
    expect(
      workSource({ terrain: 'hills', nodeResource: null, homeSlot: null }, resources, JOB_RULES),
    ).toMatchObject({ resource: 'stone', from: 'land' });
    expect(
      workSource(
        { terrain: 'pumpkin-fields', nodeResource: null, homeSlot: null },
        resources,
        JOB_RULES,
      ),
    ).toMatchObject({ resource: 'pumpkins', from: 'land' });
  });

  it('gives nothing on home land without a node, or on land with no yield', () => {
    expect(
      workSource({ terrain: 'forest', nodeResource: null, homeSlot: 2 }, resources, JOB_RULES),
    ).toBeNull();
    expect(
      workSource({ terrain: 'lake', nodeResource: null, homeSlot: null }, resources, JOB_RULES),
    ).toBeNull();
  });
});

describe('gathering speed', () => {
  const leafBrave = { element: 'leaf', feeling: 'brave' } as const;
  const leafCozy = { element: 'leaf', feeling: 'cozy' } as const;
  const fireJoy = { element: 'fire', feeling: 'joy' } as const;

  it('matches the element (or a seasonal species) and the feeling', () => {
    const timber = JOB_RULES.affinities.find((a) => a.resource === 'timber');
    const pumpkins = JOB_RULES.affinities.find((a) => a.resource === 'pumpkins');
    expect(affinityMatches(leafBrave, timber)).toBe(2);
    expect(affinityMatches(leafCozy, timber)).toBe(1);
    expect(affinityMatches(fireJoy, timber)).toBe(0);
    expect(affinityMatches({ ...fireJoy, season: 'halloween' }, pumpkins)).toBe(1);
    expect(affinityMatches(fireJoy, undefined)).toBe(0);
  });

  it('is 100, 135 or 175 percent, like the habitat match', () => {
    expect(workSpeedPercent(fireJoy, 'timber', JOB_RULES)).toBe(100);
    expect(workSpeedPercent(leafCozy, 'timber', JOB_RULES)).toBe(135);
    expect(workSpeedPercent(leafBrave, 'timber', JOB_RULES)).toBe(175);
    expect(workSpeedModifiers(leafCozy, 'timber', JOB_RULES)).toEqual([135]);
  });

  it('combines a list of whole-percent modifiers, so a timed boost can join later', () => {
    expect(combinePercents([])).toBe(100);
    expect(combinePercents([135, 120])).toBe(162);
    expect(combinePercents([175, 120, 110])).toBe(231);
    // A food boost (say 120%) on top of a match, never slower than 100%.
    expect(workSpeedPercent(leafCozy, 'timber', JOB_RULES, [120])).toBe(162);
    expect(workSpeedPercent(fireJoy, 'timber', JOB_RULES, [80])).toBe(100);
  });

  it('stretches the gather time by the cycle percent and shortens it by speed', () => {
    // 15 min × 200% = 30 min; ÷ 1.35 = 22 min 13 s (floored); ÷ 1.75 = 17 min 8 s.
    expect(workCycleSeconds(900, 100, JOB_RULES)).toBe(1800);
    expect(workCycleSeconds(900, 135, JOB_RULES)).toBe(1333);
    expect(workCycleSeconds(900, 175, JOB_RULES)).toBe(1028);
    // The tutorial's quick gathers stand in for the source's time.
    expect(workCycleSeconds(900, 100, JOB_RULES, { gatherSeconds: 10 })).toBe(20);
    expect(workCycleSeconds(1, 1000, JOB_RULES)).toBe(1);
  });
});

describe('work progress (lazy, capped)', () => {
  const since = Date.UTC(2026, 9, 10, 12);

  it('counts finished cycles and carries a part-done one', () => {
    const p = workProgress(since, since + 70 * MINUTE, 1800, JOB_RULES);
    expect(p).toEqual({
      cycles: 2,
      full: false,
      nextReadyMs: since + 90 * MINUTE,
      nextSinceMs: since + 60 * MINUTE,
      finishedMs: [since + 30 * MINUTE, since + 60 * MINUTE],
    });
  });

  it('stops at the cap and starts again from the collect', () => {
    const now = since + 10 * 60 * MINUTE;
    const p = workProgress(since, now, 1800, JOB_RULES);
    expect(p.cycles).toBe(JOB_RULES.work.maxStoredCycles);
    expect(p.full).toBe(true);
    expect(p.nextReadyMs).toBeNull();
    expect(p.nextSinceMs).toBe(now);
    expect(p.finishedMs.at(-1)).toBe(since + 4 * 30 * MINUTE);
  });

  it('has nothing before the first cycle, and never counts backwards', () => {
    expect(workProgress(since, since + MINUTE, 1800, JOB_RULES)).toMatchObject({
      cycles: 0,
      nextSinceMs: since,
      nextReadyMs: since + 30 * MINUTE,
    });
    expect(workProgress(since, since - MINUTE, 1800, JOB_RULES).cycles).toBe(0);
  });
});

describe('work yield', () => {
  it('pays each cycle with the extras in season when it finished', () => {
    const halloweenUntil = 2;
    const seasonsAt = (ms: number) => (ms <= halloweenUntil ? HALLOWEEN : NO_SEASON);
    expect(
      workYield({ resource: 'emberwood', quantity: 2 }, [1, 2, 3], resources, seasonsAt),
    ).toEqual({ emberwood: 6, 'witch-dust': 2 });
  });

  it('pays a seasonal resource only in its season', () => {
    const seasonsAt = (ms: number) => (ms === 1 ? HALLOWEEN : NO_SEASON);
    expect(workYield({ resource: 'pumpkins', quantity: 1 }, [1, 2], resources, seasonsAt)).toEqual({
      pumpkins: 1,
      'witch-dust': 1,
    });
    expect(workYield({ resource: 'pumpkins', quantity: 1 }, [], resources, seasonsAt)).toEqual({});
    expect(workYield({ resource: 'nope', quantity: 1 }, [1], resources, seasonsAt)).toEqual({});
  });
});

describe('job hints', () => {
  const species = (id: string) => GAME_DATA.species.find((s) => s.id === id);

  it('names what a squishy gathers best, from data', () => {
    const hints = jobHints(
      { element: 'leaf', feeling: 'brave', level: 5 },
      undefined,
      JOB_RULES,
      BATTLE_RULES,
    );
    expect(hints).toEqual([{ kind: 'gather', resource: 'timber', icon: '🌲', great: true }]);
    expect(jobHintText(hints[0]!, resources)).toBe('Great at gathering Timber 🌲');
  });

  it('lists double matches before single ones, at most the hint limit', () => {
    const hints = jobHints(
      { element: 'shadow', feeling: 'joy', season: 'halloween', level: 5 },
      undefined,
      JOB_RULES,
      BATTLE_RULES,
    );
    expect(hints.map((h) => (h.kind === 'gather' ? [h.resource, h.great] : h.kind))).toEqual([
      ['glimmer', false],
      ['pumpkins', false],
    ]);
  });

  it('adds what its stats lean to', () => {
    for (const s of GAME_DATA.species) {
      const hints = jobHints({ ...s, level: 10 }, species(s.id), JOB_RULES, BATTLE_RULES);
      const role = hints.at(-1);
      expect(['fighter', 'speedy', 'guard']).toContain(role?.kind);
    }
    expect(jobHintText({ kind: 'fighter' }, resources)).toBe('Strong fighter 💪');
    expect(jobHintText({ kind: 'speedy' }, resources)).toBe('Speedy fighter ⚡');
    expect(jobHintText({ kind: 'guard' }, resources)).toBe('Sturdy guard 🛡️');
  });
});

describe('Training Grounds XP (owner decision 2026-10-06)', () => {
  const HOUR = 60 * 60 * 1000;
  const rules = { training: { maxHours: 24 } };

  it('pays whole XP per hour, carrying part of a point over', () => {
    expect(trainingProgress(0, 0, 5, rules)).toEqual({ xp: 0, full: false, nextSinceMs: 0 });
    // 5 an hour: one XP every 12 minutes. 30 minutes gives 2, and 6 minutes carry on.
    expect(trainingProgress(0, HOUR / 2, 5, rules)).toEqual({
      xp: 2,
      full: false,
      nextSinceMs: (2 * HOUR) / 5,
    });
    expect(trainingProgress(0, 3 * HOUR, 8, rules).xp).toBe(24);
    // A clock that went backwards pays nothing.
    expect(trainingProgress(HOUR, 0, 5, rules)).toEqual({ xp: 0, full: false, nextSinceMs: HOUR });
  });

  it('never pays one point twice, however often it is settled', () => {
    let since = 0;
    let total = 0;
    let last = 0;
    for (let now = 0; now <= 10 * HOUR; now += 7 * 60 * 1000 + 13) {
      const step = trainingProgress(since, now, 8, rules);
      total += step.xp;
      since = step.nextSinceMs;
      last = now;
    }
    // Settling every few minutes pays what one settle at the end would.
    expect(total).toBe(trainingProgress(0, last, 8, rules).xp);
  });

  it('stops after maxHours, and starts again from the settle', () => {
    const full = trainingProgress(0, 30 * HOUR, 5, rules);
    expect(full).toEqual({ xp: 120, full: true, nextSinceMs: 30 * HOUR });
    expect(trainingProgress(0, 24 * HOUR, 5, rules)).toMatchObject({ xp: 120, full: true });
    expect(JOB_RULES.training.maxHours).toBe(24);
  });
});
