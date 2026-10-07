import type { PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { MapState } from './map-state.js';
import { describeTile, guardianLine, type TileInfo } from './tile-info.js';
import { testView, userId } from './test-view.js';

const state = new MapState(testView(2));
const lookup = (id: string) => state.member(id);

const tile = (extra: Partial<PublicTile>): PublicTile => ({
  q: 5,
  r: -1,
  terrain: 'forest',
  ownerUserId: null,
  nodeResource: null,
  homeSlot: null,
  gathering: null,
  cooldownUntil: null,
  defenders: 0,
  guardianHint: null,
  buildings: [],
  ...extra,
});

/** Style guide §9: words that never appear in player-facing text. */
const AVOIDED =
  /\b(die|dead|death|kill|faint|hurt|injure|wound|bleed|blood|damage|destroy|crush|slash|stab|bite|attack|weapon|enemy|hate|stupid|loser)\b/i;

function allText(info: TileInfo): string {
  return [info.title, info.about, info.owner, info.resource ?? '', info.guardians ?? ''].join(' ');
}

describe('describeTile', () => {
  it('names a seasonal home node only in its season (owner decision 2026-10-06)', () => {
    const patch = tile({ homeSlot: 0, ownerUserId: userId(1), nodeResource: 'pumpkins' });
    expect(describeTile(patch, lookup, userId(1), ['halloween']).resource).toBe(
      'Find Pumpkins here.',
    );
    expect(describeTile(patch, lookup, userId(1), ['thanksgiving']).resource).toBeNull();
    // Pumpkin Fields out on the map still say so all year.
    const field = tile({ terrain: 'pumpkin-fields', nodeResource: 'pumpkins' });
    expect(describeTile(field, lookup, userId(1), []).resource).toBe('Find Pumpkins here.');
  });

  it('names the terrain from the shared table', () => {
    const info = describeTile(tile({ terrain: 'old-forest' }), lookup, userId(1));
    expect(info.title).toBe('Old Forest');
    expect(info.about).toContain('Emberwood');
  });

  it('says whose land it is', () => {
    expect(describeTile(tile({}), lookup, userId(1)).owner).toBe('Wild land.');
    expect(describeTile(tile({ ownerUserId: userId(1) }), lookup, userId(1)).owner).toBe(
      'Your land.',
    );
    expect(describeTile(tile({ ownerUserId: userId(2) }), lookup, userId(1)).owner).toBe(
      "keeper2's land.",
    );
  });

  it('says home bases can never be taken, and never offers to claim them', () => {
    const mine = describeTile(tile({ homeSlot: 0, ownerUserId: userId(1) }), lookup, userId(1));
    expect(mine.home).toBe(true);
    expect(mine.owner).toBe('Your home base. Nobody can ever take it!');
    const theirs = describeTile(tile({ homeSlot: 1, ownerUserId: userId(2) }), lookup, userId(1));
    expect(theirs.owner).toBe("keeper2's home base. Nobody can ever take it!");
    const free = describeTile(tile({ homeSlot: 3 }), lookup, userId(1));
    expect(free.owner).toBe('A cozy home spot, waiting for a new Keeper.');
    for (const info of [mine, theirs, free]) expect(allText(info)).not.toMatch(/claim|challenge/i);
  });

  it('lists the resource node, if any', () => {
    expect(describeTile(tile({ nodeResource: 'timber' }), lookup, null).resource).toBe(
      'Find Timber here.',
    );
    expect(describeTile(tile({}), lookup, null).resource).toBeNull();
  });

  it("copes with terrain and owners it doesn't know", () => {
    const info = describeTile(
      tile({ terrain: 'cloud-castle', ownerUserId: userId(9) }),
      lookup,
      null,
    );
    expect(info.title).toBe('Mystery land');
    expect(info.owner).toBe('Wild land.');
  });

  it('uses no avoided words on any tile of a real map', () => {
    for (const t of state.view.tiles) {
      expect(allText(describeTile(t, lookup, userId(1)))).not.toMatch(AVOIDED);
    }
  });
});

describe('guardianLine (owner decision 10)', () => {
  it('says how many and how tough, kindly', () => {
    expect(guardianLine({ count: 3, difficulty: 'tough' })).toBe(
      'Guarded by 3 sleepy squishies • tough',
    );
    expect(guardianLine({ count: 1, difficulty: 'easy' })).toBe(
      'Guarded by 1 sleepy squishy • easy',
    );
    expect(guardianLine({ count: 2, difficulty: 'very-tough' })).toBe(
      'Guarded by 2 sleepy squishies • very tough',
    );
    for (const difficulty of ['easy', 'tough', 'very-tough'] as const) {
      expect(guardianLine({ count: 2, difficulty })).not.toMatch(AVOIDED);
    }
  });

  it('shows on wild land with a hint, and nowhere else', () => {
    const hint = { count: 2, difficulty: 'tough' as const };
    expect(describeTile(tile({ guardianHint: hint }), lookup, userId(1)).guardians).toBe(
      'Guarded by 2 sleepy squishies • tough',
    );
    expect(describeTile(tile({}), lookup, userId(1)).guardians).toBeNull();
    expect(describeTile(tile({ ownerUserId: userId(2) }), lookup, userId(1)).guardians).toBeNull();
  });
});
