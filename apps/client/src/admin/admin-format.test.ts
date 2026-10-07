import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  age,
  ago,
  auditTarget,
  codeStatusLabel,
  countdown,
  lastWeek,
  patchStatusLabel,
  plural,
  waitingLong,
} from './admin-format.js';

const NOW = new Date('2026-10-07T14:00:00Z');
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('admin-format', () => {
  it('says how long ago', () => {
    expect(ago(null, NOW)).toBe('never');
    expect(ago(before(20_000), NOW)).toBe('just now');
    expect(ago(before(6 * MIN), NOW)).toBe('6 min ago');
    expect(ago(before(2 * HOUR + 5 * MIN), NOW)).toBe('2 h ago');
    expect(ago(before(30 * HOUR), NOW)).toBe('yesterday');
    expect(ago(before(3 * DAY), NOW)).toBe('3 days ago');
    expect(ago(before(30 * DAY), NOW)).toMatch(/^Sep \d+$/);
  });

  it('says how long a request has waited, and nudges after a day', () => {
    expect(age(before(10_000), NOW)).toBe('1 min');
    expect(age(before(4 * HOUR), NOW)).toBe('4 h');
    expect(age(before(DAY + HOUR), NOW)).toBe('1 day');
    expect(age(before(2 * DAY), NOW)).toBe('2 days');
    expect(waitingLong(before(23 * HOUR), NOW)).toBe(false);
    expect(waitingLong(before(DAY), NOW)).toBe(true);
  });

  it('counts down to the idle sign-out', () => {
    expect(countdown(new Date(NOW.getTime() + 29 * MIN + 41_000).toISOString(), NOW)).toBe('29:41');
    expect(countdown(before(5000), NOW)).toBe('0:00');
  });

  it('names audit actions and their targets without secrets', () => {
    expect(actionLabel('player.reset_password')).toBe('Reset password');
    expect(actionLabel('something.new')).toBe('something.new');
    expect(auditTarget({ targetUser: 'GlimmerJo', targetMap: null, detail: {} })).toBe('GlimmerJo');
    expect(
      auditTarget({
        targetUser: 'MossyMae',
        targetMap: 'Moonlit Meadow',
        detail: { requestId: 'x' },
      }),
    ).toBe('MossyMae → Moonlit Meadow');
    expect(
      auditTarget({
        targetUser: null,
        targetMap: null,
        detail: { patch: 'cozy', from: '2026-10-04', to: '2026-10-06' },
      }),
    ).toBe('patch "cozy", joined 2026-10-04 – 2026-10-06');
    expect(
      auditTarget({ targetUser: null, targetMap: null, detail: { codeId: 'x', days: 7 } }),
    ).toBe('+7 days');
    expect(auditTarget({ targetUser: null, targetMap: null, detail: { reason: 'code' } })).toBe(
      'wrong authenticator code',
    );
    expect(auditTarget({ targetUser: null, targetMap: null, detail: {} })).toBe('—');
  });

  it('labels statuses and counts', () => {
    expect(codeStatusLabel('used_up')).toBe('used up');
    expect(codeStatusLabel('revoked')).toBe('turned off');
    expect(patchStatusLabel('requested')).toBe('asked to join');
    expect(plural(1, 'patch', 'patches')).toBe('1 patch');
    expect(plural(2, 'patch', 'patches')).toBe('2 patches');
    expect(lastWeek(NOW)).toEqual({ from: '2026-09-30', to: '2026-10-07' });
  });
});
