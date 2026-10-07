import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FENCE_RESULTS, fenceResult, RESULT_LINES, resultLine } from './result-line.js';

describe('the result card line', () => {
  it('says a wild squishy wandered off after a loss or a run home (#208)', () => {
    expect(resultLine('wild', 'lost', false)).toBe('It wandered off. Try another one nearby!');
    expect(resultLine('wild', 'scooted', false)).toBe(RESULT_LINES.wildGoneSub);
  });

  it('says a beaten wild squishy toddles away', () => {
    expect(resultLine('wild', 'won', false)).toBe(RESULT_LINES.wildWonSub);
  });

  it('never says it left on the Tutorial Glade, where it stays (#24)', () => {
    expect(resultLine('wild', 'lost', true)).toBe(RESULT_LINES.lostSub);
    expect(resultLine('wild', 'scooted', true)).toBe(RESULT_LINES.scootedSub);
    expect(resultLine('wild', 'won', true)).toBe(RESULT_LINES.wonSub);
  });

  it('keeps the usual lines for battles that aren’t wild', () => {
    expect(resultLine('tile', 'lost', false)).toBe(RESULT_LINES.lostSub);
    expect(resultLine('rival-tile', 'scooted', false)).toBe(RESULT_LINES.scootedSub);
    expect(resultLine('tile', 'won', false)).toBe(RESULT_LINES.wonSub);
  });

  it('uses no avoided words', () => {
    for (const line of Object.values(RESULT_LINES)) expect(findAvoidedWords(line)).toEqual([]);
  });

  it('words a fence battle (#203): broke it, it held, stopped, and the owner’s replay', () => {
    expect(fenceResult('mine', 'tuckered-out', false)).toBe(FENCE_RESULTS.broke);
    expect(fenceResult('theirs', 'turn-limit', false)).toBe(FENCE_RESULTS.held);
    expect(fenceResult('theirs', 'forfeit', false)).toBe(FENCE_RESULTS.stopped);
    expect(fenceResult('mine', 'turn-limit', true)).toBe(FENCE_RESULTS.replayHeld);
    expect(fenceResult('theirs', 'tuckered-out', true)).toBe(FENCE_RESULTS.replayBroke);
    for (const card of Object.values(FENCE_RESULTS)) {
      expect(findAvoidedWords(`${card.title} ${card.subtitle}`)).toEqual([]);
    }
  });
});
