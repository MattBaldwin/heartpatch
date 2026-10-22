import { describe, expect, it } from 'vitest';
import { clothingIcon, clothingSlotIcon } from './item-icons.js';

describe('clothingIcon (#306)', () => {
  it("gives a piece its own picture where its slot's would be wrong, else the slot's", () => {
    expect(clothingIcon({ id: 'lamplighters-crown', slot: 'hat' })).toBe('👑');
    expect(clothingIcon({ id: 'gearheart-wrench', slot: 'held' })).toBe('🔧');
    expect(clothingIcon({ id: 'sunny-cap', slot: 'hat' })).toBe(clothingSlotIcon('hat'));
  });
});
