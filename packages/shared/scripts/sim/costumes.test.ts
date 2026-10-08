import { describe, expect, it } from 'vitest';
import type { ClothingDropTable } from '../../src/schemas/data/clothing-drops.js';
import { COSTUME_CONFIG, type CostumeProfile } from './costumes-config.js';
import { costumeOutlook, renderCostumes, runCostumes } from './costumes.js';

const BUSY = COSTUME_CONFIG.profiles.find((p) => p.id === 'busy')!;
const ONLY_GATHERS: CostumeProfile = {
  ...BUSY,
  gathers: 10,
  tileCaptures: 0,
  rivalCaptures: 0,
  wildWins: 0,
  exploreFinds: 0,
};

describe('the costume outlook (#261)', () => {
  it('works out finds from the chance and the share of the weight', () => {
    // 10 gathers a day × 50 % × (1 of 4 weight) = 1.25 Common costumes a day.
    const tables: ClothingDropTable[] = [
      {
        source: 'gather',
        chance: 50,
        entries: [
          { item: 'patch-scarecrow', weight: 1 },
          { item: 'witch-hat', weight: 3 },
        ],
      },
    ];
    const [common] = costumeOutlook(ONLY_GATHERS, COSTUME_CONFIG, tables);
    expect(common).toMatchObject({ rarity: 'common', perDay: 1.25, daysToFind: 0.8 });
    expect(common!.inWindow).toBeCloseTo(1 - Math.pow(0.875, 100), 10);
    expect(common!.daysToBuy).toBe(Math.ceil(120 / ONLY_GATHERS.coins));
  });

  it('rolls the rival chance for rival captures', () => {
    const tables: ClothingDropTable[] = [
      {
        source: 'capture',
        chance: 0,
        rivalChance: 100,
        entries: [{ item: 'patch-scarecrow', weight: 1 }],
      },
    ];
    const rival = { ...ONLY_GATHERS, gathers: 0, rivalCaptures: 2 };
    expect(costumeOutlook(rival, COSTUME_CONFIG, tables)[0]!.perDay).toBe(2);
  });

  it('with the shipped tables, rarer is slower to find and dearer to buy, and the Mythic is never sold', () => {
    for (const row of runCostumes(COSTUME_CONFIG)) {
      expect(row.tiers.map((t) => t.rarity)).toEqual([
        'common',
        'uncommon',
        'rare',
        'epic',
        'legendary',
        'mythic',
      ]);
      for (let i = 1; i < row.tiers.length; i++) {
        expect(row.tiers[i]!.daysToFind).toBeGreaterThan(row.tiers[i - 1]!.daysToFind);
      }
      expect(row.tiers.at(-1)).toMatchObject({ price: null, daysToBuy: null });
    }
    // The issue's bar: a busy kid buys any sold tier in 3 to 8 busy days.
    const busy = runCostumes(COSTUME_CONFIG).find((r) => r.profile === 'busy')!;
    for (const tier of busy.tiers.filter((t) => t.daysToBuy !== null)) {
      expect(tier.daysToBuy).toBeGreaterThanOrEqual(3);
      expect(tier.daysToBuy).toBeLessThanOrEqual(8);
    }
    expect(renderCostumes(runCostumes(COSTUME_CONFIG), COSTUME_CONFIG)).toMatch(
      /hollow-man-costume/,
    );
  });
});
