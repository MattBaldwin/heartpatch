import { describe, expect, it } from 'vitest';
import * as publicEntry from '../../index.js';
import * as serverEntry from './index.js';

describe('@heartpatch/shared/server', () => {
  it('exports nothing the public entry exports too', () => {
    // The client bundle check bans every server export by name, so a
    // server-only table, schema or check also exported publicly would only be
    // caught once the client used it. Keep each in one entry.
    const both = Object.keys(serverEntry).filter((name) => name in publicEntry);
    expect(both).toEqual([]);
  });

  it('keeps the drop tables, their schema and the roll server-only', () => {
    for (const name of [
      'CLOTHING_DROPS',
      'ClothingDropTableSchema',
      'checkClothingDrops',
      'pickClothingDrop',
      'eligibleDrops',
    ]) {
      expect(name in serverEntry).toBe(true);
      expect(name in publicEntry).toBe(false);
    }
  });

  it("keeps the house's gift table, its schema and the roll server-only (#381 PR H)", () => {
    for (const name of [
      'HOUSE_GIFTS',
      'HouseGiftTableSchema',
      'checkHouseGifts',
      'rollHouseGift',
      'houseGiftRow',
      'houseGiftNote',
      'houseGiftSeed',
    ]) {
      expect(name in serverEntry).toBe(true);
      expect(name in publicEntry).toBe(false);
    }
  });

  it("keeps trick-or-treat's prize table, its schema and the roll server-only (#515)", () => {
    for (const name of [
      'TRICK_OR_TREAT_PRIZES',
      'TrickOrTreatPrizesSchema',
      'checkTrickOrTreatPrizes',
      'trickOrTreatCostumes',
      'rollTrickOrTreat',
      'trickOrTreatSeed',
    ]) {
      expect(name in serverEntry).toBe(true);
      expect(name in publicEntry).toBe(false);
    }
  });

  it("keeps the found sets' drop tables, their schema and the roll server-only (#306 PR 5)", () => {
    for (const name of [
      'REKINDLED_DROPS',
      'FoundSetDropTableSchema',
      'checkFoundSetDrops',
      'rollFoundSet',
      'rollFoundSets',
    ]) {
      expect(name in serverEntry).toBe(true);
      expect(name in publicEntry).toBe(false);
    }
    expect('FOUND_SETS' in publicEntry).toBe(true);
  });
});
