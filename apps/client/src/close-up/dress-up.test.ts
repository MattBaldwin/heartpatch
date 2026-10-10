import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { accessoryItem } from '../procedural/accessory.js';
import { DRESS_UP_TEXT, dressedLine, dressUpChoices } from './dress-up.js';

const owned = (...ids: string[]) => ids.map((itemId) => ({ itemId, count: 1 }));

describe('dress up (#340)', () => {
  it('lists Nothing first, then my accessories in catalog order, never Keeper clothing', () => {
    const choices = dressUpChoices(
      owned('tiny-crown', 'sunny-cap', 'tiny-bow', 'snuggle-scarf'),
      null,
    );
    expect(choices.map((c) => c.itemId)).toEqual([null, 'tiny-bow', 'snuggle-scarf', 'tiny-crown']);
    expect(choices[0]).toMatchObject({
      name: 'Nothing',
      sub: 'Take it off',
      on: true,
      color: null,
    });
    expect(choices[1]).toMatchObject({ name: 'Tiny Bow', sub: 'Common', color: '#ff6f91' });
  });

  it('marks the one it wears', () => {
    const choices = dressUpChoices(owned('tiny-bow', 'tiny-crown'), 'tiny-crown');
    expect(choices.filter((c) => c.on).map((c) => c.itemId)).toEqual(['tiny-crown']);
    expect(choices.find((c) => c.itemId === 'tiny-crown')?.sub).toBe('✓ Wearing');
    expect(choices[0]?.on).toBe(false);
  });

  it('knows only squishy accessories', () => {
    expect(accessoryItem('tiny-bow')?.name).toBe('Tiny Bow');
    expect(accessoryItem('sunny-cap')).toBeNull();
    expect(accessoryItem('no-such-thing')).toBeNull();
    expect(accessoryItem(null)).toBeNull();
  });

  it('cheers the choice the server kept', () => {
    expect(dressedLine('Pip', 'tiny-crown')).toBe('Pip loves the Tiny Crown!');
    expect(dressedLine('Pip', null)).toBe('Pip is all cozy as they are.');
  });

  it('speaks kindly (style guide §9)', () => {
    const lines = [
      ...Object.values(DRESS_UP_TEXT).map((t) => (typeof t === 'function' ? t('Pip', 'Hat') : t)),
    ];
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});
