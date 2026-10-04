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
});
