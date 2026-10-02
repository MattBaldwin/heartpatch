import type { PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { MapState } from './map-state.js';
import { describeTile, type TileInfo } from './tile-info.js';
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
  ...extra,
});

/** Style guide §9: words that never appear in player-facing text. */
const AVOIDED =
  /\b(die|dead|death|kill|faint|hurt|injure|wound|bleed|blood|damage|destroy|crush|slash|stab|bite|attack|weapon|enemy|hate|stupid|loser)\b/i;

function allText(info: TileInfo): string {
  return [info.title, info.about, info.owner, info.resource ?? ''].join(' ');
}

describe('describeTile', () => {
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
