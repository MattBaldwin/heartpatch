import { describe, expect, it } from 'vitest';
import { showsStats } from './stats-flag.js';

describe('showsStats', () => {
  it('always shows in a dev build', () => {
    expect(showsStats(true, new URLSearchParams(''))).toBe(true);
  });

  it('shows in production only with ?fps=1', () => {
    expect(showsStats(false, new URLSearchParams(''))).toBe(false);
    expect(showsStats(false, new URLSearchParams('?fps=1'))).toBe(true);
    expect(showsStats(false, new URLSearchParams('?tier=low&fps=1'))).toBe(true);
    expect(showsStats(false, new URLSearchParams('?fps=0'))).toBe(false);
    expect(showsStats(false, new URLSearchParams('?fps=yes'))).toBe(false);
  });
});
