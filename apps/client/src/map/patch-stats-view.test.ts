import { PatchStatsSchema, type KeeperStats } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { SOON, statsPage } from './patch-stats-view.js';

const keeper = (id: string, name: string, extra: Partial<KeeperStats> = {}): KeeperStats => ({
  user: { id, username: name },
  homeSlot: 0,
  tiles: 7,
  homesteads: 0,
  buildings: [],
  lit: 0,
  befriended: 0,
  species: 0,
  villages: null,
  crowns: [],
  ...extra,
});

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const stats = PatchStatsSchema.parse({
  totals: { claimed: 14, wild: 30, lit: 3, villages: null },
  keepers: [
    keeper(A, 'ada', {
      buildings: [
        { buildingId: 'hearthfire', count: 2 },
        { buildingId: 'cozy-meadow', count: 1 },
      ],
      crowns: ['land', 'builder'],
    }),
    keeper(B, 'bo', { homeSlot: 1, crowns: [] }),
  ],
});

describe('statsPage (#573)', () => {
  const page = statsPage(stats, B);

  it('shows the totals, with villages as "soon" until restoring arrives', () => {
    expect(page.totals.map((t) => [t.label, t.value])).toEqual([
      ['Claimed', '14'],
      ['Wild left', '30'],
      ['Lit', '3'],
      ['Villages restored', SOON],
    ]);
  });

  it("names each Keeper's crowns and buildings, and marks me", () => {
    const [ada, bo] = page.keepers;
    expect(ada?.crowns.map((c) => c.label)).toEqual(['Most land', 'Best builder']);
    expect(ada?.buildings).toEqual(['Hearthfire ×2', 'Cozy Meadow ×1']);
    expect(ada?.cheer).toBeNull();
    expect(bo).toMatchObject({ name: 'bo (you)', mine: true, buildings: [] });
  });

  it('cheers a Keeper with no crown yet instead of ranking them', () => {
    expect(page.keepers[1]?.cheer).toBe('Just getting started!');
    expect(JSON.stringify(page)).not.toMatch(/last|loser|1st|2nd|3rd/i);
  });
});
