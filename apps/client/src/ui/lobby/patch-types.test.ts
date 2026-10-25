import { findAvoidedWords, MAP_MAX_PLAYERS } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { isWildIsle, PATCH_TYPE_CHOICES, WILD_ISLE_CHIP, wildIsleOffered } from './patch-types.js';

describe('patch types on "Make a patch" (#621)', () => {
  it('offers Cozy first, then Wild Isle', () => {
    expect(PATCH_TYPE_CHOICES.map((c) => c.type)).toEqual(['cozy', 'wild-isle']);
  });

  it('offers a Wild Isle only when the server says so, at the seats it has a layout for', () => {
    expect(MAP_MAX_PLAYERS).toBe(6);
    expect(wildIsleOffered(true)).toBe(true);
    expect(wildIsleOffered(false)).toBe(false);
    // An older server leaves it out: hidden.
    expect(wildIsleOffered(undefined)).toBe(false);
    // Wild Isle is 6 seats only (MAP_GEN.wildIsle.layouts).
    expect(wildIsleOffered(true, 4)).toBe(false);
  });

  it('reads a patch with no type as cozy', () => {
    expect(isWildIsle({})).toBe(false);
    expect(isWildIsle({ patchType: 'cozy' })).toBe(false);
    expect(isWildIsle({ patchType: 'wild-isle' })).toBe(true);
  });

  it('keeps its words kind and short', () => {
    for (const choice of PATCH_TYPE_CHOICES) {
      expect(findAvoidedWords(`${choice.label} ${choice.hint}`)).toEqual([]);
      expect(choice.hint.split(' ').length).toBeLessThanOrEqual(10);
    }
    expect(WILD_ISLE_CHIP).toContain('🌊');
  });
});
