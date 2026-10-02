import { describe, expect, it } from 'vitest';
import { formatTimeLeft, GameClock } from './game-clock.js';

describe('GameClock', () => {
  it('counts down on the server clock, not the phone clock', () => {
    let device = Date.parse('2026-01-01T00:00:00Z'); // a phone with the wrong date
    const clock = new GameClock(() => device);
    clock.sync('2026-10-31T20:00:00Z');
    expect(clock.msUntil('2026-10-31T20:15:00Z')).toBe(15 * 60_000);
    device += 60_000;
    expect(clock.msUntil('2026-10-31T20:15:00Z')).toBe(14 * 60_000);
    expect(clock.msUntil('2026-10-31T19:00:00Z')).toBe(0);
  });

  it('ignores a time it cannot read', () => {
    const clock = new GameClock(() => 1_000);
    clock.sync('not a time');
    expect(clock.now()).toBe(1_000);
  });
});

describe('formatTimeLeft', () => {
  it('reads short at every size', () => {
    expect(formatTimeLeft(45_000)).toBe('45s');
    expect(formatTimeLeft(245_000)).toBe('4:05');
    expect(formatTimeLeft(65 * 60_000)).toBe('1h 5m');
  });

  it('rounds up, so it never says 0s before it is ready', () => {
    expect(formatTimeLeft(1)).toBe('1s');
    expect(formatTimeLeft(0)).toBe('0s');
    expect(formatTimeLeft(-5)).toBe('0s');
  });
});
