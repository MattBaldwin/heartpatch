import { describe, expect, it } from 'vitest';
import { countdownAt, formatTimeLeft, formatWait, GameClock } from './game-clock.js';

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

describe('formatWait (#201)', () => {
  const MIN = 60_000;
  it('shows hours and minutes, rounded up to the minute', () => {
    expect(formatWait((3 * 60 + 20) * MIN)).toBe('3h 20m');
    expect(formatWait((3 * 60 + 19) * MIN + 1)).toBe('3h 20m');
    expect(formatWait(65 * MIN)).toBe('1h 05m');
    expect(formatWait(5 * 60 * MIN)).toBe('5h');
    expect(formatWait(25 * MIN)).toBe('25m');
    expect(formatWait(MIN)).toBe('1m');
  });

  it('says less than a minute at the end, never 0m', () => {
    expect(formatWait(59_999)).toBe('less than a minute');
    expect(formatWait(1)).toBe('less than a minute');
    expect(formatWait(0)).toBe('less than a minute');
  });
});

describe('countdownAt (#201)', () => {
  it('asks the server again once, when the countdown reaches zero', () => {
    let device = Date.parse('2026-10-06T23:59:00Z');
    const clock = new GameClock(() => device);
    const until = '2026-10-07T00:00:00.000Z';
    expect(countdownAt(clock, until, null)).toEqual({ wait: '1m', ask: false });
    device += 30_000;
    expect(countdownAt(clock, until, null)).toEqual({ wait: 'less than a minute', ask: false });
    device += 30_000;
    expect(countdownAt(clock, until, null).ask).toBe(true);
    // Already asked about this one: don't ask every tick while the reply comes.
    expect(countdownAt(clock, until, until).ask).toBe(false);
    // The fresh reply's next reset counts down again.
    expect(countdownAt(clock, '2026-10-08T00:00:00.000Z', until)).toEqual({
      wait: '24h',
      ask: false,
    });
  });
});
