import { describe, expect, it } from 'vitest';
import { COMMUNITY_RULES } from '../data/communities.js';
import { safeTiles } from '../home/safe-tiles.js';
import { hexKey } from '../hex/index.js';
import {
  extraFactoryBatches,
  extraGuardLevels,
  morningGiftOf,
  villageKind,
  villageLights,
  type PerkVillage,
} from './perks.js';

const square = { q: 4, r: -2 };
const village = (kind: PerkVillage['kind'], ownerUserId: string | null): PerkVillage => ({
  kind,
  ownerUserId,
  square,
});

describe('village perks (#306 PR 3b)', () => {
  it('lights a won Lantern Tower every night, the ring and one tile past it', () => {
    expect(villageLights([village('lantern-tower', null)], COMMUNITY_RULES)).toEqual([]);
    const lights = villageLights([village('lantern-tower', 'kid')], COMMUNITY_RULES);
    expect(lights).toEqual([{ at: square, radius: 2 }]);
    const lit = safeTiles(lights);
    expect(lit.size).toBe(19);
    expect(lit.has(hexKey({ q: 6, r: -2 }))).toBe(true);
    expect(lit.has(hexKey({ q: 7, r: -2 }))).toBe(false);
    // Other kinds give no light.
    expect(villageLights([village('workshop', 'kid')], COMMUNITY_RULES)).toEqual([]);
  });

  it("adds a Workshop's batch for its winner only, one each", () => {
    const won = [village('workshop', 'kid'), village('workshop', 'kid'), village('bakery', 'kid')];
    expect(extraFactoryBatches(won, 'kid', COMMUNITY_RULES)).toBe(2);
    expect(extraFactoryBatches(won, 'rival', COMMUNITY_RULES)).toBe(0);
    expect(extraFactoryBatches([village('workshop', null)], 'kid', COMMUNITY_RULES)).toBe(0);
  });

  it('gives the Old Well and the Bakery a morning gift', () => {
    expect(morningGiftOf('old-well', COMMUNITY_RULES)).toEqual({ water: 2, greens: 2 });
    expect(morningGiftOf('bakery', COMMUNITY_RULES)).toEqual({ treats: 3 });
    expect(morningGiftOf('lantern-tower', COMMUNITY_RULES)).toBeNull();
    // A kind the rules don't list does nothing, rather than throwing.
    const stale = { kinds: COMMUNITY_RULES.kinds.filter((k) => k.id !== 'bakery') };
    expect(morningGiftOf('bakery', stale)).toBeNull();
    expect(villageLights([village('bakery', 'kid')], stale)).toEqual([]);
  });

  it("raises a Watchtower winner's guard level floor by 2, theirs only", () => {
    const won = [village('watchtower', 'kid'), village('lantern-tower', 'kid')];
    expect(extraGuardLevels(won, 'kid', COMMUNITY_RULES)).toBe(2);
    expect(extraGuardLevels(won, 'rival', COMMUNITY_RULES)).toBe(0);
    expect(villageKind('watchtower', COMMUNITY_RULES)?.does).toBe(
      'your guards fight 2 levels stronger',
    );
  });
});
