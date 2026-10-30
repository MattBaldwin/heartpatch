import { describe, expect, it } from 'vitest';
import { LONG_NIGHT_OFF, longNightOnFor, longNightSwitchOf } from './switch.js';

const lee = { username: 'Lee' };
const sam = { username: 'sam' };

describe('the Long Night switch (#727)', () => {
  it('is off for every patch unless set', () => {
    expect(longNightOnFor(LONG_NIGHT_OFF, [lee, sam])).toBe(false);
    const off = longNightSwitchOf({ HP_LONG_NIGHT: 'off', HP_LONG_NIGHT_TESTERS: ['lee'] });
    expect(longNightOnFor(off, [lee])).toBe(false);
  });

  it('runs on a patch with a tester among its members while on testers', () => {
    const testers = longNightSwitchOf({ HP_LONG_NIGHT: 'testers', HP_LONG_NIGHT_TESTERS: ['lee'] });
    expect(longNightOnFor(testers, [sam, lee])).toBe(true);
    expect(longNightOnFor(testers, [sam])).toBe(false);
    expect(longNightOnFor(testers, [])).toBe(false);
  });

  it('runs on every patch while on', () => {
    const on = longNightSwitchOf({ HP_LONG_NIGHT: 'on', HP_LONG_NIGHT_TESTERS: [] });
    expect(longNightOnFor(on, [sam])).toBe(true);
    expect(longNightOnFor(on, [])).toBe(true);
  });
});
