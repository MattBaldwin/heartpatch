import { JOB_RULES, RESOURCES, workSource, type PublicTile } from '@heartpatch/shared';
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
  return [
    info.title,
    info.about,
    info.owner,
    info.resource ?? '',
    info.guardians ?? '',
    info.gatherer ?? '',
  ].join(' ');
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

  it('names a trading post, says it’s everyone’s, and how I reach it (#269)', () => {
    const post = tile({ terrain: 'trading-post', post: { index: 1, name: 'Lantern Post' } });
    const far = describeTile(post, lookup, userId(1), [], { kind: 'journey', distance: 3 });
    expect(far.title).toBe('Lantern Post');
    expect(far.owner).toBe('A trading post for every Keeper. Nobody can claim it!');
    expect(far.post?.reach).toMatch(/3 tiles from your land/);
    expect(far.guardians).toBeNull();
    expect(far.gatherer).toBeNull();
    expect(allText(far) + far.post!.reach!).not.toMatch(AVOIDED);
    const near = describeTile(post, lookup, userId(1), [], { kind: 'connected' });
    expect(near.post?.reach).toMatch(/Your land reaches it/);
    // Everywhere else: no post line.
    expect(describeTile(tile({}), lookup, userId(1)).post).toBeNull();
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
    expect(free.owner).toBe('A cozy home, saved for the next Keeper who joins! ✨');
    for (const info of [mine, theirs, free]) expect(allText(info)).not.toMatch(/claim|challenge/i);
  });

  it('lists the resource node, if any', () => {
    expect(describeTile(tile({ nodeResource: 'timber' }), lookup, null).resource).toBe(
      'Find Timber here.',
    );
    expect(describeTile(tile({}), lookup, null).resource).toBeNull();
  });

  it('says what a squishy gatherer picks, from the shared gather rule (#238)', () => {
    // Out on the land, the land's main resource, whatever spot it has: a
    // forest's Greens spot is the Keeper's, and its Timber the squishies'.
    const forest = describeTile(tile({ terrain: 'forest', nodeResource: 'greens' }), lookup, null);
    expect(forest.resource).toBe('Find Greens here.');
    expect(forest.gatherer).toBe('Squishies gather 🌲 Timber here.');
    expect(describeTile(tile({ terrain: 'meadow' }), lookup, null).gatherer).toBe(
      'Squishies gather 🌿 Greens here.',
    );
    expect(
      describeTile(tile({ terrain: 'lake', nodeResource: 'water' }), lookup, null).gatherer,
    ).toBe('Squishies gather 💧 Water here.');
    expect(
      describeTile(tile({ terrain: 'mountains', nodeResource: 'glimmer' }), lookup, null).gatherer,
    ).toBe('Squishies gather 🧊 Ice here.');
    // In the home ring, a spot is what squishies work; bare home land gives nothing.
    expect(
      describeTile(tile({ terrain: 'forest', homeSlot: 0, nodeResource: 'stone' }), lookup, null)
        .gatherer,
    ).toBe('Squishies gather 🪨 Stone here.');
    expect(
      describeTile(tile({ terrain: 'forest', homeSlot: 0 }), lookup, null).gatherer,
    ).toBeNull();
    expect(describeTile(tile({ terrain: 'junipers-gap' }), lookup, null).gatherer).toBeNull();
    // The panel and the gather rule can't drift: every tile of a real map agrees.
    for (const t of state.view.tiles) {
      const source = workSource(t, RESOURCES, JOB_RULES);
      const line = describeTile(t, lookup, null).gatherer;
      if (source === null) expect(line).toBeNull();
      else expect(line).toContain(RESOURCES.find((r) => r.id === source.resource)?.name ?? '?');
    }
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

describe('guardianLine (owner decision 10, #216)', () => {
  it('says how many, how they really feel and how tough, kindly', () => {
    expect(guardianLine({ count: 1, difficulty: 'easy', feelings: ['brave'] })).toBe(
      'Guarded by 1 Brave squishy • easy',
    );
    expect(
      guardianLine({ count: 3, difficulty: 'tough', feelings: ['sleepy', 'sleepy', 'sleepy'] }),
    ).toBe('Guarded by 3 Sleepy squishies • tough');
    // Repeats counted, in team order.
    expect(
      guardianLine({ count: 3, difficulty: 'very-tough', feelings: ['sleepy', 'joy', 'sleepy'] }),
    ).toBe('Guarded by 3 squishies: 2 Sleepy, 1 Joy • very tough');
    expect(
      guardianLine({ count: 3, difficulty: 'tough', feelings: ['spooky', 'cozy', 'silly'] }),
    ).toBe('Guarded by 3 squishies: 1 Spooky, 1 Cozy, 1 Silly • tough');
  });

  it("says no feeling when an older server doesn't send them", () => {
    expect(guardianLine({ count: 1, difficulty: 'easy', feelings: [] })).toBe(
      'Guarded by 1 squishy • easy',
    );
    expect(guardianLine({ count: 2, difficulty: 'tough', feelings: [] })).toBe(
      'Guarded by 2 squishies • tough',
    );
  });

  it('never uses an avoided word, whatever the feelings', () => {
    const feelings = ['joy', 'cozy', 'brave', 'silly', 'sleepy', 'spooky'] as const;
    for (const difficulty of ['easy', 'tough', 'very-tough'] as const) {
      for (const f of feelings) {
        expect(guardianLine({ count: 2, difficulty, feelings: [f, 'joy'] })).not.toMatch(AVOIDED);
      }
    }
  });

  it('shows on wild land with a hint, and nowhere else', () => {
    const hint = {
      count: 2,
      difficulty: 'tough' as const,
      feelings: ['joy' as const, 'joy' as const],
    };
    expect(describeTile(tile({ guardianHint: hint }), lookup, userId(1)).guardians).toBe(
      'Guarded by 2 Joy squishies • tough',
    );
    expect(describeTile(tile({}), lookup, userId(1)).guardians).toBeNull();
    expect(describeTile(tile({ ownerUserId: userId(2) }), lookup, userId(1)).guardians).toBeNull();
  });
});
