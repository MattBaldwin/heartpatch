import { describe, expect, it } from 'vitest';
import { spawnWindowAt, spawnWindowMidpoint } from './window.js';

describe('spawnWindowAt (tech spec §8)', () => {
  it('ids the map-local date and 0-based block', () => {
    expect(spawnWindowAt({ date: '2026-10-31', hour: 20 }, 4)).toEqual({
      id: '2026-10-31/5',
      date: '2026-10-31',
      block: 5,
      hours: 4,
    });
    expect(spawnWindowAt({ date: '2026-10-31', hour: 0 }, 4).id).toBe('2026-10-31/0');
    expect(spawnWindowAt({ date: '2026-10-31', hour: 3 }, 4).id).toBe('2026-10-31/0');
    expect(spawnWindowAt({ date: '2026-10-31', hour: 4 }, 4).id).toBe('2026-10-31/1');
    expect(spawnWindowAt({ date: '2026-10-31', hour: 23 }, 24).id).toBe('2026-10-31/0');
    expect(spawnWindowAt({ date: '2026-10-31', hour: 23 }, 1).id).toBe('2026-10-31/23');
  });

  it('only takes block lengths that divide a day, and real hours and dates', () => {
    expect(() => spawnWindowAt({ date: '2026-10-31', hour: 1 }, 5)).toThrow(/divide a day/);
    expect(() => spawnWindowAt({ date: '2026-10-31', hour: 0 }, 0)).toThrow(/divide a day/);
    expect(() => spawnWindowAt({ date: '2026-10-31', hour: 24 }, 4)).toThrow(/0–23/);
    expect(() => spawnWindowAt({ date: '2026-02-30', hour: 1 }, 4)).toThrow();
  });

  it('judges a block by its middle', () => {
    expect(spawnWindowMidpoint(spawnWindowAt({ date: '2026-10-31', hour: 17 }, 4))).toBe(18);
    expect(spawnWindowMidpoint(spawnWindowAt({ date: '2026-10-31', hour: 0 }, 1))).toBe(0.5);
  });
});
