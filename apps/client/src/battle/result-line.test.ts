import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { RESULT_LINES, resultLine } from './result-line.js';

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
});
