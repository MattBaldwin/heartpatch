import { describe, expect, it } from 'vitest';
import { nameList, reasonLine } from './auth-help-text.js';

describe('account help words (#197)', () => {
  it('lists names the way a kid would say them', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Pip_42'])).toBe('Pip_42');
    expect(nameList(['Pip_42', 'Jojo'])).toBe('Pip_42 and Jojo');
    expect(nameList(['Pip_42', 'MomBear', 'Jojo'])).toBe('Pip_42, MomBear and Jojo');
  });

  it('says why a grown-up is on your helper list', () => {
    expect(reasonLine('invited-you', null)).toBe('Made your family code');
    expect(reasonLine('patch-owner', 'Pumpkin Hill')).toBe('Owner of Pumpkin Hill');
    expect(reasonLine('patch-mate', 'Pumpkin Hill')).toBe('Plays in Pumpkin Hill');
  });
});
