import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { MINIBOSSES_OFF, minibossOpenFor, minibossSwitchOf } from './switch.js';

const DATABASE_URL = 'postgres://localhost/heartpatch';

describe('the mini-boss switch (#234)', () => {
  it('is off for every patch unless set', () => {
    const unset = minibossSwitchOf(loadConfig({ DATABASE_URL }));
    expect(unset).toEqual(MINIBOSSES_OFF);
    expect(minibossOpenFor(unset, 'Lee')).toBe(false);
    const off = minibossSwitchOf({ HP_MINI_BOSSES: 'off', HP_MINI_BOSSES_TESTERS: ['lee'] });
    expect(minibossOpenFor(off, 'lee')).toBe(false);
  });

  it('opens only patches a tester owns while on testers, whatever the case', () => {
    const testers = minibossSwitchOf(
      loadConfig({ DATABASE_URL, HP_MINI_BOSSES: 'testers', HP_MINI_BOSSES_TESTERS: ' Lee ,sam' }),
    );
    expect(testers.testers).toEqual(['lee', 'sam']);
    expect(minibossOpenFor(testers, 'LEE')).toBe(true);
    expect(minibossOpenFor(testers, 'sam')).toBe(true);
    expect(minibossOpenFor(testers, 'pip')).toBe(false);
    // A patch with no owner seat isn't anyone's to test on.
    expect(minibossOpenFor(testers, null)).toBe(false);
  });

  it('opens every patch while on', () => {
    const on = minibossSwitchOf({ HP_MINI_BOSSES: 'on', HP_MINI_BOSSES_TESTERS: [] });
    expect(minibossOpenFor(on, 'pip')).toBe(true);
    expect(minibossOpenFor(on, null)).toBe(true);
  });

  it('refuses a mode it does not know', () => {
    expect(() => loadConfig({ DATABASE_URL, HP_MINI_BOSSES: 'yes' })).toThrow();
  });
});
