import { describe, expect, it } from 'vitest';
import { PUSH_OFF, pushOnFor, pushSwitchOf } from './switch.js';

const lee = { username: 'Lee' };
const sam = { username: 'sam' };

describe('the push switch (#726)', () => {
  it('is off for every player unless set', () => {
    expect(pushOnFor(PUSH_OFF, lee)).toBe(false);
    const off = pushSwitchOf({ HP_PUSH: 'off', HP_PUSH_TESTERS: ['lee'] });
    expect(pushOnFor(off, lee)).toBe(false);
  });

  it('is on only for testers while on testers, whatever their patch', () => {
    const testers = pushSwitchOf({ HP_PUSH: 'testers', HP_PUSH_TESTERS: ['lee'] });
    expect(pushOnFor(testers, lee)).toBe(true);
    expect(pushOnFor(testers, { username: 'LEE' })).toBe(true);
    expect(pushOnFor(testers, sam)).toBe(false);
    expect(pushOnFor(pushSwitchOf({ HP_PUSH: 'testers', HP_PUSH_TESTERS: [] }), lee)).toBe(false);
  });

  it('is on for every player while on', () => {
    const on = pushSwitchOf({ HP_PUSH: 'on', HP_PUSH_TESTERS: [] });
    expect(pushOnFor(on, sam)).toBe(true);
    expect(pushOnFor(on, lee)).toBe(true);
  });
});
