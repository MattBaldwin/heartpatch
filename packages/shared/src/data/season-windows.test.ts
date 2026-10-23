import { describe, expect, it } from 'vitest';
import type { Season } from '../schemas/data/seasons.js';
import { activeSeasons, nextSeasonRun, seasonRunAt } from './season-windows.js';
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

describe('seasonRunAt and nextSeasonRun (#306 PR 6)', () => {
  const at = (date: string) => {
    const run = seasonRunAt(SEASONS, date);
    return run ? `${run.id} ${String(run.year)}` : null;
  };
  const next = (date: string) => {
    const run = nextSeasonRun(SEASONS, date);
    return run ? `${run.id} ${run.takesOverOn}` : null;
  };

  it('is the season running now, its first and last day included', () => {
    expect(at('2026-10-01')).toBe('halloween 2026');
    expect(at('2026-10-22')).toBe('halloween 2026');
    expect(at('2026-12-15')).toBe('christmas 2026');
    expect(seasonRunAt(SEASONS, '2026-10-22')).toMatchObject({
      startsOn: '2026-10-01',
      endsOn: '2026-11-09',
    });
  });

  it('holds a running season until its own window ends when windows overlap (#306 6b)', () => {
    // Halloween 2026 runs to Nov 9 though Thanksgiving starts Nov 3: the far
    // Hollow's house doesn't reset mid-playtest.
    for (const day of ['03', '05', '09']) expect(at(`2026-11-${day}`)).toBe('halloween 2026');
    expect(at('2026-11-10')).toBe('thanksgiving 2026');
    // Christmas keeps Dec 31; New Year takes the 1st.
    expect(at('2026-12-31')).toBe('christmas 2026');
    expect(at('2027-01-01')).toBe('new-year 2026');
    // Without the override, Halloween ends Nov 2 and Thanksgiving takes Nov 3.
    expect(at('2027-11-02')).toBe('halloween 2027');
    expect(at('2027-11-03')).toBe('thanksgiving 2027');
  });

  it('keeps the last season between seasons, across the new year', () => {
    expect(at('2027-01-02')).toBe('new-year 2026');
    expect(at('2027-07-04')).toBe('new-year 2026');
    expect(at('2027-09-30')).toBe('new-year 2026');
    expect(at('2027-10-01')).toBe('halloween 2027');
  });

  it('finds the day the next season takes over, this year or the next', () => {
    expect(next('2026-10-22')).toBe('thanksgiving 2026-11-10');
    expect(next('2026-11-09')).toBe('thanksgiving 2026-11-10');
    expect(next('2026-11-10')).toBe('christmas 2026-12-01');
    expect(next('2026-12-15')).toBe('new-year 2027-01-01');
    expect(next('2027-01-01')).toBe('halloween 2027-10-01');
    expect(next('2027-07-04')).toBe('halloween 2027-10-01');
  });

  it('is null with no seasons, and refuses a bad date', () => {
    expect(seasonRunAt([], '2026-10-22')).toBeNull();
    expect(nextSeasonRun([], '2026-10-22')).toBeNull();
    expect(() => seasonRunAt(SEASONS, '2026-10-1')).toThrow();
  });
});
