import { findAvoidedWords, type StrandedTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  nearestGap,
  splitStranded,
  strandedLine,
  strandedPhase,
  STRANDED_TEXT,
} from './stranded-text.js';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const tile = (q: number, since: string, wildAt = '2026-10-27T12:00:00.000Z'): StrandedTile => ({
  q,
  r: 0,
  since,
  wildAt,
});
const PAST = '2026-10-25T10:00:00.000Z';
const FUTURE = '2026-10-25T20:00:00.000Z';

describe('stranded land', () => {
  it('tells grace (since ahead) from fading (since passed)', () => {
    expect(strandedPhase(tile(0, FUTURE), NOW)).toBe('grace');
    expect(strandedPhase(tile(0, PAST), NOW)).toBe('fading');
    expect(strandedPhase(tile(0, new Date(NOW).toISOString()), NOW)).toBe('fading');
  });

  it('splits by look', () => {
    const s = splitStranded([tile(1, FUTURE), tile(2, PAST), tile(3, PAST)], NOW);
    expect(s.grace.map((t) => t.q)).toEqual([1]);
    expect(s.fading.map((t) => t.q)).toEqual([2, 3]);
  });

  it('picks the copy: fading wins when any has started', () => {
    expect(strandedLine([tile(1, FUTURE)], NOW)).toBe(STRANDED_TEXT.soon);
    expect(strandedLine([tile(1, FUTURE), tile(2, PAST)], NOW)).toBe(STRANDED_TEXT.fading);
  });

  it('finds the nearest gap, else the soonest to go wild', () => {
    const list = [
      tile(5, PAST, '2026-10-27T12:00:00.000Z'),
      tile(2, PAST, '2026-10-28T12:00:00.000Z'),
    ];
    expect(nearestGap(list, { q: 0, r: 0 })?.q).toBe(2);
    expect(nearestGap(list)?.q).toBe(5);
    expect(nearestGap([])).toBeNull();
  });

  it('says plainly what to do, gentler before the fading starts', () => {
    expect(STRANDED_TEXT.fading).toBe(
      'These tiles are drifting away! Build a road to bring them home.',
    );
    expect(STRANDED_TEXT.soon).toMatch(/may drift away soon/);
    expect(STRANDED_TEXT.soon).toMatch(/road/);
    expect(STRANDED_TEXT.fading).not.toMatch(/Fading!/);
  });

  it('stays cozy and kid-safe', () => {
    const lines = Object.values(STRANDED_TEXT).join(' ');
    expect(findAvoidedWords(lines)).toEqual([]);
  });
});
