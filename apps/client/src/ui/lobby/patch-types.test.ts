import { findAvoidedWords, GAME_DATA, MAP_MAX_PLAYERS } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  CLOCKWORK_ISLE_CHIP,
  clockworkIsleOffered,
  isClockworkIsle,
  isWildIsle,
  PATCH_TYPE_CHOICES,
  WILD_ISLE_CHIP,
  wildIsleOffered,
} from './patch-types.js';

describe('patch types on "Make a patch" (#621)', () => {
  it('offers Cozy first, then Wild Isle, then Clockwork Isle', () => {
    expect(PATCH_TYPE_CHOICES.map((c) => c.type)).toEqual(['cozy', 'wild-isle', 'clockwork-isle']);
  });

  it('says what plan §7 says on the Clockwork card (#874)', () => {
    const card = PATCH_TYPE_CHOICES.find((c) => c.type === 'clockwork-isle');
    expect(card?.icon).toBe('⚙️');
    expect(card?.label).toBe('Clockwork Isle');
    expect(card?.hint).toBe('Wind, wires and workshops. For clever Keepers!');
    expect(CLOCKWORK_ISLE_CHIP).toBe('⚙️ Clockwork Isle');
  });

  it('offers a Clockwork Isle only when the server says so, at the seats it has a layout for', () => {
    const hasLayout =
      GAME_DATA.mapGen.clockworkIsle?.island.layouts.some((l) => l.players === MAP_MAX_PLAYERS) ??
      false;
    expect(clockworkIsleOffered(true)).toBe(hasLayout);
    // The gate off, or an older server that leaves it out: hidden.
    expect(clockworkIsleOffered(false)).toBe(false);
    expect(clockworkIsleOffered(undefined)).toBe(false);
    // No 4-seat layout.
    expect(clockworkIsleOffered(true, 4)).toBe(false);
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
    expect(isWildIsle({ patchType: 'clockwork-isle' })).toBe(false);
    expect(isClockworkIsle({})).toBe(false);
    expect(isClockworkIsle({ patchType: 'wild-isle' })).toBe(false);
    expect(isClockworkIsle({ patchType: 'clockwork-isle' })).toBe(true);
  });

  it('keeps its words kind and short', () => {
    for (const choice of PATCH_TYPE_CHOICES) {
      expect(findAvoidedWords(`${choice.label} ${choice.hint} ${choice.nameHint}`)).toEqual([]);
      expect(choice.hint.split(' ').length).toBeLessThanOrEqual(10);
    }
    expect(WILD_ISLE_CHIP).toContain('🌊');
  });
});
