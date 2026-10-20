import { findAvoidedWords, RESOURCES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  BATTLE_POTIONS,
  chipsAfterDrinking,
  chipsOf,
  CHIP_LOOKS,
  itemButtonLabel,
  itemButtonName,
  NO_CHIPS,
  noPotionLine,
  pickLine,
  potionTiles,
  potionTotal,
  SHIELD_CALLOUT,
  SHIELD_LINE,
  SIPPED_CALLOUT,
  sipLine,
  sippedLabel,
  sippedLine,
  sippedName,
  usedLine,
} from './potions.js';

describe('battle potions in the HUD (#214)', () => {
  it('lists every battle item from shared data, each with its own picture', () => {
    expect(BATTLE_POTIONS.map((p) => p.id)).toEqual(
      RESOURCES.filter((r) => r.battleEffect).map((r) => r.id),
    );
    expect(BATTLE_POTIONS.map((p) => p.id)).toEqual(['brave-brew', 'cozy-cocoa', 'hearty-soup']);
    expect(BATTLE_POTIONS.map((p) => p.icon)).toEqual(['🧪', '☕', '🍲']);
  });

  it('counts every potion on the button, and says nothing while the bag loads', () => {
    expect(itemButtonLabel(null)).toBe('🧪');
    expect(itemButtonLabel(3)).toBe('🧪 3');
    expect(itemButtonName(null)).toBe('Use item');
    expect(itemButtonName(3)).toBe('Use item, 3 in your bag');
    expect(potionTotal(null)).toBeNull();
    expect(potionTotal({ 'brave-brew': 1, 'cozy-cocoa': 2, timber: 9 })).toBe(3);
    expect(potionTotal({})).toBe(0);
  });

  it('dims a tile with none in the bag or one already had, and says why', () => {
    const tiles = potionTiles({ 'brave-brew': 1, 'cozy-cocoa': 2 }, ['cozy-cocoa']);
    expect(tiles.map(({ id, count, state, tag }) => ({ id, count, state, tag }))).toEqual([
      { id: 'brave-brew', count: 1, state: 'ready', tag: 'Bolder!' },
      { id: 'cozy-cocoa', count: 2, state: 'used', tag: 'Had one!' },
      { id: 'hearty-soup', count: 0, state: 'empty', tag: 'Make in Bag' },
    ]);
    // While the bag loads, every potion can be tried (the server has the final say).
    expect(potionTiles(null, []).map((t) => [t.count, t.state, t.tag])).toEqual([
      [null, 'ready', 'Bolder!'],
      [null, 'ready', 'Softer bumps'],
      [null, 'ready', 'More energy'],
    ]);
  });

  it('shows chips from the battle state', () => {
    expect(chipsOf({ boosts: { attack: 0, defense: 0 }, shield: 0 })).toEqual(NO_CHIPS);
    expect(chipsOf({ boosts: { attack: 40, defense: 0 }, shield: 75 })).toEqual({
      ...NO_CHIPS,
      attack: true,
      shield: true,
    });
    // Steady and Big (#587): a guard or an opening until the next hit.
    expect(chipsOf({ boosts: { attack: 0, defense: 0 }, shield: 0, guard: 25 })).toEqual({
      ...NO_CHIPS,
      guard: true,
    });
    expect(chipsOf({ boosts: { attack: 0, defense: 0 }, shield: 0, guard: -25 })).toEqual({
      ...NO_CHIPS,
      open: true,
    });
  });

  it('adds a potion’s chips and puts the shield up, keeping earlier boosts', () => {
    const brew = chipsAfterDrinking(NO_CHIPS, 'brave-brew');
    expect(brew).toEqual({ ...NO_CHIPS, attack: true, shield: true });
    const both = chipsAfterDrinking({ ...brew, shield: false }, 'cozy-cocoa');
    expect(both).toEqual({ ...NO_CHIPS, attack: true, defense: true, shield: true });
    expect(chipsAfterDrinking(NO_CHIPS, 'hearty-soup')).toEqual({ ...NO_CHIPS, shield: true });
    expect(chipsAfterDrinking({ ...NO_CHIPS, guard: true }, 'hearty-soup').guard).toBe(true);
    expect(chipsAfterDrinking(NO_CHIPS, 'timber')).toEqual(NO_CHIPS);
    expect(CHIP_LOOKS.attack.text).toBe('⚔️+');
    expect(CHIP_LOOKS.defense.text).toBe('🛡️+');
  });

  it('says a sip, a slurp and the shield kindly, in short lines', () => {
    expect(sipLine('Emberbun', 'brave-brew')).toBe('Emberbun sipped Brave Brew! Feeling bold!');
    expect(sipLine('Emberbun', 'cozy-cocoa')).toBe('Emberbun sipped Cozy Cocoa! So snug!');
    expect(sipLine('Emberbun', 'hearty-soup')).toBe('Emberbun slurped Hearty Soup! Much better!');
    expect(noPotionLine('cozy-cocoa')).toBe(
      'No Cozy Cocoa yet! Make it from 2 Treats + 2 Timber in your Bag.',
    );
    expect(usedLine('brave-brew')).toBe('You already had Brave Brew this battle!');
    const lines = [
      ...BATTLE_POTIONS.flatMap((p) => [sipLine('Pip', p.id), noPotionLine(p.id), usedLine(p.id)]),
      ...potionTiles({}, ['brave-brew']).map((t) => t.tag),
      ...Object.values(CHIP_LOOKS).map((c) => c.label),
      SHIELD_CALLOUT,
      SHIELD_LINE,
      pickLine('Pip'),
      SIPPED_CALLOUT,
      ...BATTLE_POTIONS.flatMap((p) => [sippedLabel(p.id), sippedName(p.id), sippedLine(p.id)]),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });

  it('a potion is a free sip (#403): "Sipped ✓", and the move still comes', () => {
    expect(pickLine('Pip')).toBe('Pick a potion! Pip still gets a move.');
    expect(pickLine('Pip')).not.toMatch(/turn/);
    expect(sippedLabel('cozy-cocoa')).toBe('☕ Sipped ✓');
    expect(sippedLabel('brave-brew')).toBe('🧪 Sipped ✓');
    expect(sippedName('cozy-cocoa')).toBe('Cozy Cocoa sipped. Tap to put it back.');
    expect(SIPPED_CALLOUT).toBe('Sipped ✓');
    expect(sippedLine('hearty-soup')).toBe('Sipped Hearty Soup! Now pick a move!');
  });
});
