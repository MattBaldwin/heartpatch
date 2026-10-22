import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { MEMORY_PUZZLES } from '../data/memory-puzzles.js';
import { StoryDealSchema } from '../schemas/explore.js';
import {
  checkStory,
  clueHolds,
  clueText,
  makeStory,
  storyAnswer,
  storyDeal,
  storyFits,
  storyMoments,
  storySeed,
  type StoryClue,
} from './story.js';

const RULES = MEMORY_PUZZLES.story;
// Enough days to cover every Hollow size, and cheap enough under coverage on CI.
const SEEDS = 80;

describe('storyMoments (#306)', () => {
  it('holds 5 moments for 4–5 tiles and 6 for 6–7, as the mockup', () => {
    expect([4, 5, 6, 7].map((t) => storyMoments(t, RULES))).toEqual([5, 5, 6, 6]);
  });
});

describe('makeStory (#306)', () => {
  it('is the same day from the same seed, and a new try is a new day', () => {
    const seed = storySeed('hollow-seed', { q: 2, r: -1 }, 'kid', 1);
    expect(makeStory(seed, 5, RULES)).toEqual(makeStory(seed, 5, RULES));
    const next = storySeed('hollow-seed', { q: 2, r: -1 }, 'kid', 2);
    expect(storyDeal(makeStory(next, 5, RULES))).not.toEqual(storyDeal(makeStory(seed, 5, RULES)));
    // Another kid on the same tile and try gets their own day.
    const other = storySeed('hollow-seed', { q: 2, r: -1 }, 'other kid', 1);
    expect(other).not.toBe(seed);
  });

  it('always has exactly one answer, one clue a tile, and gives at most one place away', () => {
    let spares = 0;
    let days = 0;
    for (const tiles of [4, 5, 6, 7]) {
      for (let s = 0; s < SEEDS; s++) {
        const day = makeStory(`seed-${tiles}-${s}`, tiles, RULES);
        const n = storyMoments(tiles, RULES);
        expect(day.moments).toHaveLength(n);
        expect(day.clues).toHaveLength(tiles);
        expect(new Set(day.moments.map((m) => m.id)).size).toBe(n);
        // The answer fits every clue, and no other order does (all n! checked).
        const pos: number[] = [];
        day.order.forEach((m, place) => (pos[m] = place));
        for (const clue of day.clues) expect(clueHolds(clue, pos, n)).toBe(true);
        expect(storyFits(day.clues, n, 2)).toBe(1);
        // Every page counts: leave any one out and more than one order fits
        // (a 7-tile Hollow's day is the rare exception: more pages than it needs).
        const spare = day.clues.filter(
          (_, k) =>
            storyFits(
              day.clues.filter((__, j) => j !== k),
              n,
              2,
            ) === 1,
        ).length;
        if (tiles <= 6) {
          spares += spare > 0 ? 1 : 0;
          days += 1;
        }
        expect(
          day.clues.filter((c) => c.kind === 'first' || c.kind === 'last').length,
        ).toBeLessThanOrEqual(RULES.maxPlaceClues);
        expect(checkStory(day, storyAnswer(day))).toEqual({
          kind: 'checked',
          ok: true,
          right: n,
          marks: new Array<boolean>(n).fill(true),
        });
      }
    }
    // Up to 6 tiles, a day with a spare clue is rare.
    expect(spares / days).toBeLessThan(0.1);
    // Every order of 320 days: a few seconds under CI's coverage run, as mapgen's property tests.
  }, 30_000);

  it('never deals the cards already in order, and never sends the order', () => {
    for (let s = 0; s < SEEDS; s++) {
      const day = makeStory(`deal-${s}`, 5, RULES);
      const deal = storyDeal(day);
      expect(deal.moments.map((m) => m.id)).not.toEqual(storyAnswer(day));
      expect(StoryDealSchema.strict().parse(deal)).toEqual(deal);
      expect(Object.keys(deal).sort()).toEqual(['clues', 'moments']);
      for (const m of deal.moments) expect(Object.keys(m).sort()).toEqual(['emoji', 'id', 'text']);
    }
  });

  it('writes clues a kid can read: short and kind', () => {
    for (let s = 0; s < 20; s++) {
      for (const clue of storyDeal(makeStory(`words-${s}`, 7, RULES)).clues) {
        expect(clue.length).toBeLessThanOrEqual(160);
        expect(findAvoidedWords(clue)).toEqual([]);
        expect(clue).toMatch(/^[A-Z].*\.$/);
      }
    }
  });
});

describe('clueText and clueHolds (#306)', () => {
  const moments = RULES.moments.slice(0, 5);
  // The day in order: bell, baker, miller, fiddler, ferry.
  const pos = [0, 1, 2, 3, 4];
  const clues: [StoryClue, string, boolean][] = [
    [{ kind: 'first', a: 0 }, 'The bell rang before anything else happened.', true],
    [{ kind: 'last', a: 4 }, 'The ferry left, and then the lanterns went out.', true],
    [{ kind: 'notEnds', a: 0 }, 'The bell rang, but not first and not last.', false],
    [
      { kind: 'before', a: 1, b: 3 },
      'The baker sold pies sometime before the fiddler played.',
      true,
    ],
    [
      { kind: 'right', a: 1, b: 2 },
      'Right after the baker sold pies, the miller ground oats.',
      true,
    ],
    [
      { kind: 'notNext', a: 0, b: 1 },
      'The bell ringing and the baker selling pies were not one after the other.',
      false,
    ],
    [
      { kind: 'gap', a: 0, b: 3, between: 2 },
      'Between the bell ringing and the fiddler playing, exactly two things happened.',
      true,
    ],
  ];
  it.each(clues)('%o reads right and checks right', (clue, text, holds) => {
    expect(clueText(clue, moments)).toBe(text);
    expect(clueHolds(clue, pos, 5)).toBe(holds);
  });
});

describe('checkStory (#306)', () => {
  const day = makeStory('check', 5, RULES);
  const answer = storyAnswer(day);

  it('marks each place right or wrong', () => {
    const swapped = [answer[1], answer[0], ...answer.slice(2)] as string[];
    expect(checkStory(day, swapped)).toEqual({
      kind: 'checked',
      ok: false,
      right: 3,
      marks: [false, false, true, true, true],
    });
  });

  it('refuses an order that is not the day’s moments once each', () => {
    const bad = { kind: 'not-the-moments' };
    expect(checkStory(day, answer.slice(1))).toEqual(bad);
    expect(checkStory(day, [answer[0], ...answer.slice(0, 4)] as string[])).toEqual(bad);
    expect(checkStory(day, [...answer.slice(0, 4), 'not-a-moment'])).toEqual(bad);
    expect(checkStory(day, [...answer, answer[0] as string])).toEqual(bad);
  });
});
