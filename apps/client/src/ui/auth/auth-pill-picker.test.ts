import { describe, expect, it } from 'vitest';
import { birthYearPills } from './auth-pill-picker.js';

describe('birthYearPills', () => {
  it('offers the birth years of ages 10 to 17, newest first', () => {
    expect(birthYearPills(2026)).toEqual([
      '2016',
      '2015',
      '2014',
      '2013',
      '2012',
      '2011',
      '2010',
      '2009',
    ]);
  });

  it('only offers years the full list also has', () => {
    // The signup list runs from age 4 to 99 (auth-overlay.ts).
    const years = birthYearPills(2030).map(Number);
    expect(Math.max(...years)).toBeLessThanOrEqual(2030 - 4);
    expect(Math.min(...years)).toBeGreaterThanOrEqual(2030 - 99);
  });
});
