import { findAvoidedWords, JOURNEY_RULES, type JobsView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  averageLevel,
  JOURNEY_TEXT,
  journeyChance,
  journeyPreview,
  journeyResult,
  journeyTeamLevels,
  LANTERNS,
  passLeft,
} from './journey-model.js';
import { GameClock } from '../inventory/game-clock.js';

type Job = JobsView['squishies'][number];
const squishy = (
  n: number,
  level: number,
  job: Job['job'],
  teamSlot: number | null = null,
): Job => ({
  squishy: {
    id: `0190a8c4-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`,
    mapId: '0190a8c4-0000-7000-8000-00000000000a',
    ownerUserId: '0190a8c4-0000-7000-8000-000000000001',
    speciesId: 'emberbun',
    element: 'fire',
    feeling: 'cozy',
    nickname: null,
    level,
    xp: 0,
    state: 'active',
  },
  job,
  teamSlot,
  post: null,
  habitatId: null,
  work: null,
  training: null,
  fullXpResetAt: null,
  gatherFits: [],
  houseRoomId: null,
});
const RULES = { teamSize: 3, maxStoredCycles: 4 };

describe('journeyPreview', () => {
  it('shows the shared rules’ level and team size, and lights a lantern a tile', () => {
    expect(journeyPreview(3)).toEqual({ distance: 3, level: 10, teamSize: 2, lanterns: 3 });
    expect(journeyPreview(1).lanterns).toBe(1);
    // Uncapped trips still fit the meter.
    expect(journeyPreview(12)).toMatchObject({ level: 28, teamSize: 3, lanterns: LANTERNS });
  });
});

describe('journeyTeamLevels', () => {
  it('is the picked team in slot order', () => {
    const jobs = {
      squishies: [squishy(1, 9, 'team', 1), squishy(2, 30, 'resting'), squishy(3, 14, 'team', 0)],
      rules: RULES,
    };
    expect(journeyTeamLevels(jobs)).toEqual([14, 9]);
  });

  it('is the strongest resting squishies with nobody picked, never guards or gatherers', () => {
    const jobs = {
      squishies: [
        squishy(1, 5, 'resting'),
        squishy(2, 40, 'guard'),
        squishy(3, 12, 'resting'),
        squishy(4, 8, 'resting'),
        squishy(5, 30, 'gatherer'),
        squishy(6, 3, 'resting'),
      ],
      rules: RULES,
    };
    expect(journeyTeamLevels(jobs)).toEqual([12, 8, 5]);
    expect(journeyTeamLevels({ squishies: [], rules: RULES })).toEqual([]);
  });

  it('averages to a whole level', () => {
    expect(averageLevel([14, 11, 10])).toBe(12);
    expect(averageLevel([])).toBe(0);
  });
});

describe('journeyChance (calibrated on the sim’s journey table, #270)', () => {
  it('reads the sim’s easy, middling and hard trips the same way', () => {
    // Casual kid, day 3 (16/10/14): distance 5 won 98 %, 6 won 61 %, 7 won 29 %.
    const day3 = [16, 10, 14];
    expect(journeyChance(day3, journeyPreview(5))).toBe('good');
    expect(journeyChance(day3, journeyPreview(6))).toBe('try');
    expect(journeyChance(day3, journeyPreview(7))).toBe('tough');
    // Casual kid, day 1 (8/5/4): distance 2 won 88 %, 3 won 1 %.
    const day1 = [8, 5, 4];
    expect(journeyChance(day1, journeyPreview(2))).not.toBe('tough');
    expect(journeyChance(day1, journeyPreview(3))).toBe('tough');
    // Day 14 (24/19/19): distance 8 won 99 %.
    expect(journeyChance([24, 19, 19], journeyPreview(8))).toBe('good');
  });

  it('is tough with nobody free', () => {
    expect(journeyChance([], journeyPreview(1))).toBe('tough');
  });
});

describe('journeyResult', () => {
  it('names the post and the pass on a win, and says nothing was lost otherwise', () => {
    expect(journeyResult('won', 'Lantern Post')).toEqual({
      title: 'You made it to Lantern Post!',
      subtitle: `The post is open for you for ${String(JOURNEY_RULES.visitMinutes)} minutes.`,
      done: 'Open the post 🏮',
    });
    expect(journeyResult('lost', 'Lantern Post').subtitle).toMatch(/didn't lose a thing/);
    expect(journeyResult('scooted', null).subtitle).toMatch(/didn't lose a thing/);
    expect(journeyResult('won', null).title).toBe('You made it to the trading post!');
  });

  it('says the far road (#306 PR 6) arrives in the far Hollow, and loses nothing otherwise', () => {
    expect(journeyResult('won', 'Lantern Post', { to: 'far-hollow' })).toEqual({
      title: 'You made it to the far Hollow!',
      subtitle: 'A crooked old house waits for you all season.',
      done: "Let's see 🕯️",
    });
    // A journey this device didn't start (a reload): the win card promises neither a pass nor the far Hollow.
    const somewhere = journeyResult('won', null, { to: 'unknown' });
    expect(somewhere).toEqual({
      title: 'You made it! 🧭',
      subtitle: 'Back to the map to see where your journey took you.',
    });
    expect(JSON.stringify(somewhere)).not.toMatch(/open|far Hollow|minutes/);
    expect(journeyResult('lost', null, { to: 'unknown' }).subtitle).toMatch(/didn't lose a thing/);
    expect(journeyResult('lost', null, { to: 'far-hollow' }).subtitle).toMatch(
      /didn't lose a thing/,
    );
  });
});

describe('the visit pass countdown', () => {
  it('counts whole minutes up, never "0 minutes"', () => {
    expect(JOURNEY_TEXT.open(20 * 60_000)).toBe('⏳ The post is open for you for 20 more minutes!');
    expect(JOURNEY_TEXT.open(61_000)).toBe('⏳ The post is open for you for 2 more minutes!');
    expect(JOURNEY_TEXT.open(5_000)).toBe('⏳ The post is open for you for 1 more minute!');
  });

  it('is open until the pass ends, and over after', () => {
    const until = '2026-10-20T15:20:00.000Z';
    expect(passLeft(until, Date.parse('2026-10-20T15:00:00.000Z'))).toBe(20 * 60_000);
    expect(passLeft(until, Date.parse(until))).toBeNull();
    expect(passLeft(until, Date.parse('2026-10-20T15:21:00.000Z'))).toBeNull();
    expect(passLeft(null, 0)).toBeNull();
  });

  // The pass ends 20 minutes after the server's now; the phone's clock may be
  // days off (or the dev server set to Halloween, #561).
  const serverNow = '2026-10-20T15:00:00.000Z';
  const until = '2026-10-20T15:20:00.000Z';
  for (const [label, device] of [
    ['a day behind', Date.parse('2026-10-19T15:00:00.000Z')],
    ['a month ahead', Date.parse('2026-11-20T15:00:00.000Z')],
  ] as const) {
    it(`counts down on the game clock with the device clock ${label}`, () => {
      const clock = new GameClock(() => device);
      clock.sync(serverNow);
      expect(JOURNEY_TEXT.open(passLeft(until, clock.now()) ?? 0)).toBe(
        '⏳ The post is open for you for 20 more minutes!',
      );
      // On the device clock alone it would be wrong: far too long, or over.
      const onDevice = passLeft(until, device);
      expect(onDevice === null || onDevice > 60 * 60_000).toBe(true);
    });
  }
});

describe('journey words (style guide §9)', () => {
  it('uses no avoided word', () => {
    const texts = [
      JOURNEY_TEXT.heading('Lantern Post'),
      JOURNEY_TEXT.trail(3, 10),
      JOURNEY_TEXT.team(12),
      JOURNEY_TEXT.noTeam,
      ...Object.values(JOURNEY_TEXT.chance),
      JOURNEY_TEXT.stakes(20),
      JOURNEY_TEXT.start,
      JOURNEY_TEXT.open(20 * 60_000),
      JOURNEY_TEXT.wonTitle('Lantern Post'),
      JOURNEY_TEXT.wonSub(20),
      JOURNEY_TEXT.wonDone,
      JOURNEY_TEXT.lostTitle,
      JOURNEY_TEXT.lostSub,
      JOURNEY_TEXT.scootedTitle,
      JOURNEY_TEXT.scootedSub,
      JOURNEY_TEXT.startCaption,
      JOURNEY_TEXT.somePost,
    ];
    for (const text of texts) expect(findAvoidedWords(text), text).toEqual([]);
  });
});
