import { describe, expect, it } from 'vitest';
import { itemChips } from './item-chips.js';

describe('itemChips', () => {
  it('says which land a clearing tool clears (#242)', () => {
    expect(itemChips('axe').map((c) => c.text)).toContain('🌱 Clears forests');
    expect(itemChips('pickaxe').map((c) => c.text)).toContain('🌱 Clears mountains');
    expect(itemChips('spade').map((c) => c.text)).toContain('🌱 Clears meadows and hills');
  });
});
