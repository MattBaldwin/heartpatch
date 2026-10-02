import { describe, expect, it } from 'vitest';
import type { Season } from '../schemas/data/seasons.js';
import { activeSeasons } from './season-windows.js';
import { SEASONS } from './seasons.js';

const active = (date: string) => activeSeasons(SEASONS, date).map((s) => s.id);

describe('activeSeasons', () => {
  it('finds nothing outside every window', () => {
    expect(active('2026-07-04')).toEqual([]);
    expect(active('2026-09-30')).toEqual([]);
  });

  it('treats both ends of a window as inclusive', () => {
    expect(active('2027-10-01')).toEqual(['halloween']);
    expect(active('2027-11-02')).toEqual(['halloween']);
    expect(active('2027-11-03')).toEqual(['thanksgiving']);
  });

  it('uses the 2026 Halloween override to Nov 9, overlapping Thanksgiving', () => {
    expect(active('2026-11-03')).toEqual(['halloween', 'thanksgiving']);
    expect(active('2026-11-09')).toEqual(['halloween', 'thanksgiving']);
    expect(active('2026-11-10')).toEqual(['thanksgiving']);
  });

  it('only applies an override to its own year', () => {
    expect(active('2025-11-05')).toEqual(['thanksgiving']);
    expect(active('2027-11-05')).toEqual(['thanksgiving']);
  });

  it('overlaps New Year with Christmas on Dec 31', () => {
    expect(active('2026-12-30')).toEqual(['christmas']);
    expect(active('2026-12-31')).toEqual(['christmas', 'new-year']);
  });

  it('wraps New Year into the next year', () => {
    expect(active('2027-01-01')).toEqual(['new-year']);
    expect(active('2027-01-02')).toEqual(['new-year']);
    expect(active('2027-01-03')).toEqual([]);
  });

  it('keys a wrapping override by its start year', () => {
    const party: Season = {
      id: 'party',
      name: 'Party',
      description: 'Hooray!',
      window: { start: '12-31', end: '01-02' },
      overrides: { '2026': { start: '12-28', end: '01-05' } },
    };
    const on = (date: string) => activeSeasons([party], date).length === 1;
    expect(on('2026-12-28')).toBe(true);
    expect(on('2027-01-05')).toBe(true); // the 2026 window, still running
    expect(on('2027-01-06')).toBe(false);
    expect(on('2027-12-28')).toBe(false); // 2027 uses the recurring window
    expect(on('2028-01-02')).toBe(true);
    expect(on('2028-01-03')).toBe(false);
    expect(on('2026-01-05')).toBe(false); // the 2025 window ended Jan 2
  });

  it('handles a leap day', () => {
    const leap: Season = {
      id: 'leap',
      name: 'Leap',
      description: 'Hop!',
      window: { start: '02-29', end: '02-29' },
    };
    expect(activeSeasons([leap], '2028-02-29')).toHaveLength(1);
    expect(activeSeasons([leap], '2027-02-28')).toHaveLength(0);
    expect(activeSeasons([leap], '2027-03-01')).toHaveLength(0);
  });

  it('rejects dates that are not real map-local dates', () => {
    for (const bad of ['2026-13-01', '2027-02-29', '2026-10-1', '10-31', '2026-10-31T00:00']) {
      expect(() => activeSeasons(SEASONS, bad)).toThrow();
    }
  });
});
