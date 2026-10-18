import { describe, expect, it } from 'vitest';
import { checkTrickOrTreatRules } from '../../schemas/data/trick-or-treat.js';
import {
  checkTrickOrTreatPrizes,
  trickOrTreatCostumes,
} from '../../schemas/data/trick-or-treat-prizes.js';
import { CLOTHING } from '../clothing.js';
import { GAME_DATA } from '../index.js';
import { TRICK_OR_TREAT } from '../trick-or-treat.js';
import { TRICK_OR_TREAT_PRIZES } from './trick-or-treat-prizes.js';

describe('trick-or-treat data (#515)', () => {
  it('passes its checks', () => {
    expect(checkTrickOrTreatRules(TRICK_OR_TREAT, GAME_DATA)).toEqual([]);
    expect(checkTrickOrTreatPrizes(TRICK_OR_TREAT_PRIZES, CLOTHING)).toEqual([]);
  });

  it('offers the #261 Halloween costumes, but never the Mythic Hollow Man', () => {
    const keeper = trickOrTreatCostumes(CLOTHING, 'keeper-costume').map((i) => i.id);
    expect(keeper).toHaveLength(9);
    // And the six squishy costumes (#552).
    expect(trickOrTreatCostumes(CLOTHING, 'squishy-costume')).toHaveLength(6);
    expect(keeper).toContain('bat-buddy');
    expect(keeper).not.toContain('hollow-man-costume');
    for (const id of keeper) expect(CLOTHING.find((i) => i.id === id)?.slot).toBe('costume');
  });

  it('refuses a lantern home worse than a plain one, a range upside down, or a costume that never comes up', () => {
    const broken = structuredClone(TRICK_OR_TREAT_PRIZES);
    broken.plain.heartdust = { weight: 60, min: 3, max: 3 };
    broken.lantern.heartdust = { weight: 90, min: 3, max: 2 };
    broken.rarityWeights.rare = 0;
    expect(checkTrickOrTreatPrizes(broken, CLOTHING)).toEqual([
      'lantern.heartdust: min is more than max',
      'lantern.heartdust: less than a plain home gives',
      'lantern: fewer costumes than a plain home',
      ...CLOTHING.filter((i) => i.rarity === 'rare' && i.sources.includes('trick-or-treat')).map(
        (i) => `rarityWeights: "rare" is 0, so ${i.id} never comes up`,
      ),
    ]);
  });

  it('refuses a lantern that is not a Halloween Hearthfire', () => {
    expect(
      checkTrickOrTreatRules({ ...TRICK_OR_TREAT, lanternBuildingId: 'hearthfire' }, GAME_DATA),
    ).toEqual(['lanternBuildingId: "hearthfire" isn\'t a halloween Hearthfire']);
    expect(checkTrickOrTreatRules({ ...TRICK_OR_TREAT, season: 'spring' }, GAME_DATA)).toEqual([
      'season: unknown season "spring"',
      'lanternBuildingId: "jack-o-lantern-hearthfire" isn\'t a spring Hearthfire',
    ]);
  });
});
