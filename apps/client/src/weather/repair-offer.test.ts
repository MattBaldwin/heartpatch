import { describe, expect, it } from 'vitest';
import { FIX_TEXT, repairOffer } from './repair-offer.js';

describe('repairOffer', () => {
  it('is null unless the building is knocked and has a bill', () => {
    expect(repairOffer({}, { knocked: false, repairCost: { timber: 1 } })).toBeNull();
    expect(repairOffer({}, { knocked: true })).toBeNull();
  });

  it('says whether the bag can cover it', () => {
    const b = { knocked: true, repairCost: { timber: 2 } };
    expect(repairOffer({ timber: 1 }, b)?.affordable).toBe(false);
    expect(repairOffer({ timber: 2 }, b)?.affordable).toBe(true);
  });

  it('keeps the words cozy', () => {
    const all = [
      FIX_TEXT.knocked('Pier'),
      FIX_TEXT.fixed('Pier', 'fishing-pier'),
      FIX_TEXT.fixed('Hut', 'hut'),
    ];
    expect(all.join(' ')).not.toMatch(/damag|destroy|broke/i);
  });
});
