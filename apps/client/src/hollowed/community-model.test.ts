import {
  COMMUNITY_RULES,
  hexKey,
  hexNeighbors,
  type CommunityView,
  type MapView,
} from '@heartpatch/shared';
import { findHomeBases } from '../map/map-layout.js';
import { describe, expect, it } from 'vitest';
import { describeTile } from '../map/tile-info.js';
import { communityId, testView, userId } from '../map/test-view.js';
import {
  COMMUNITY_TEXT,
  communityFlagLabel,
  communityOf,
  communityPanel,
  greyTiles,
  hollowedTileInfo,
  kindLine,
  perkLine,
  villageSeeds,
  villageSquares,
} from './community-model.js';

const village = (over: Partial<CommunityView> = {}): CommunityView => ({
  id: communityId(1),
  name: 'Bramble Hollow',
  kind: 'workshop',
  square: { q: 4, r: -2 },
  tiles: [
    { q: 4, r: -2 },
    { q: 3, r: -2 },
    { q: 4, r: -3 },
    { q: 5, r: -2 },
    { q: 5, r: -3 },
  ],
  restored: 1,
  ownerUserId: null,
  reach: 'touching',
  distance: null,
  ...over,
});

describe('communityFlagLabel', () => {
  it('says how far restoring has got when my land touches it', () => {
    expect(communityFlagLabel(village())).toBe('🕯️ Bramble Hollow · 1/5 restored');
  });

  it('says how far away it is otherwise, one tile or many', () => {
    expect(communityFlagLabel(village({ reach: 'away', distance: 3 }))).toBe(
      '🕯️ Bramble Hollow · 3 tiles away',
    );
    expect(communityFlagLabel(village({ reach: 'away', distance: 1 }))).toBe(
      '🕯️ Bramble Hollow · 1 tile away',
    );
  });

  it('is just its name for someone with no land here', () => {
    expect(communityFlagLabel(village({ reach: null }))).toBe('🕯️ Bramble Hollow');
  });
});

describe('communityPanel', () => {
  it('opens by day when my land touches it', () => {
    const panel = communityPanel(village(), 'old-forest', false);
    expect(panel.title).toBe('Old Forest · Hollowed 🕯️');
    expect(panel.restored).toBe('Bramble Hollow. 1 of 5 tiles restored.');
    // The reach line first, so it shows without scrolling on an iPhone SE.
    expect(panel.lines).toEqual([
      '🔗 Your land touches it! Exploring and restoring open soon 🕯️',
      '🛠️ Workshop: restore it for one more Factory batch.',
      'Grey, quiet and a little spooky. Rare squishies love quiet places…',
    ]);
    expect(panel.open).toBe(true);
    expect(panel.note).toBeNull();
    // Once a later PR hooks the buttons up, the line says what to do.
    const explore = communityPanel(village(), 'old-forest', false, true);
    expect(explore.lines[0]).toBe(
      '🔗 Your land touches it. Explore by day, restore with Heartdust!',
    );
    // Explore open (2a), Restore not yet (PR 3): a word under the buttons.
    expect(explore.note).toBe('Restoring opens soon 🛠️');
    expect(
      communityPanel(village(), 'old-forest', false, true, COMMUNITY_RULES, true).note,
    ).toBeNull();
    expect(communityPanel(village(), 'old-forest', true, true).note).toBeNull();
  });

  it('says how to get there when it is away', () => {
    const far = communityPanel(village({ reach: 'away', distance: 4 }), 'meadow', false);
    expect(far.lines[0]).toBe('🧭 4 tiles from your land. Claim land toward it to explore!');
    expect(far.open).toBe(false);
    expect(far.note).toBeNull();
    const near = communityPanel(village({ reach: 'away', distance: 1 }), 'meadow', false);
    expect(near.lines[0]).toBe('🧭 1 tile from your land. Claim land toward it to explore!');
    expect(communityPanel(village({ reach: null }), 'meadow', false).lines[0]).toBe(
      COMMUNITY_TEXT.noLand,
    );
  });

  it('closes at night, whatever the reach', () => {
    for (const reach of ['touching', 'away', null] as const) {
      const panel = communityPanel(
        village({ reach, distance: reach === 'away' ? 2 : null }),
        'hills',
        true,
      );
      expect(panel.lines[0]).toBe('Open by day only. Too spooky after dark!');
      expect(panel.open).toBe(false);
      expect(panel.note).toBeNull();
    }
  });

  it('names every kind with its emoji and perk', () => {
    for (const kind of COMMUNITY_RULES.kinds) {
      expect(kindLine(kind.id)).toBe(`${kind.emoji} ${kind.name}: restore it for ${kind.perk}.`);
    }
  });

  it('keeps every line short and free of avoided words (style guide §2, §9)', () => {
    const avoided =
      /\b(die|dead|death|kill|faint|hurt|injure|wound|bleed|blood|damage|destroy|crush|slash|stab|bite|attack|weapon|enemy|hate|stupid|loser)\b/i;
    const words = [
      ...Object.values(COMMUNITY_TEXT).filter((v) => typeof v === 'string'),
      COMMUNITY_TEXT.away(3),
      COMMUNITY_TEXT.restored('Bramble Hollow', 1, 5),
    ];
    for (const line of words) {
      expect(line).not.toMatch(avoided);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(12);
    }
  });
});

describe('the map view’s villages', () => {
  const view = testView(1);
  const villages = view.communities ?? [];

  it('greys every tile of every village nobody has won', () => {
    expect(villages.length).toBeGreaterThanOrEqual(2);
    const grey = greyTiles(view);
    expect(grey.size).toBe(villages.reduce((n, c) => n + c.tiles.length, 0));
    for (const t of view.tiles) {
      expect(grey.has(hexKey(t))).toBe(t.communityId !== null && t.communityId !== undefined);
    }
    // A won village is someone's land again: drawn in colour.
    const [first, ...rest] = villages;
    if (!first) throw new Error('no village');
    const won = { ...view, communities: [{ ...first, ownerUserId: userId(1) }, ...rest] };
    expect(greyTiles(won).size).toBe(grey.size - first.tiles.length);
    expect(villageSquares(won).has(hexKey(first.square))).toBe(false);
    expect(greyTiles({ communities: undefined }).size).toBe(0);
  });

  it('finds a tile’s village by its id, or by its place', () => {
    const c = villages[0];
    if (!c) throw new Error('no village');
    const tile = view.tiles.find((t) => t.communityId === c.id);
    if (!tile) throw new Error('no village tile');
    expect(communityOf(view, tile)?.id).toBe(c.id);
    expect(communityOf(view, { ...tile, communityId: undefined })?.id).toBe(c.id);
    const wild = view.tiles.find((t) => !t.communityId && t.homeSlot === null);
    if (!wild) throw new Error('no wild tile');
    expect(communityOf(view, wild)).toBeNull();
  });

  it('heads a village tile’s panel with the Hollowed title and its progress', () => {
    const c = villages[0];
    const tile = view.tiles.find((t) => t.communityId === c?.id);
    if (!c || !tile) throw new Error('no village tile');
    const info = describeTile(tile, () => undefined, userId(1));
    const shown = hollowedTileInfo(info, tile, view);
    expect(shown.title).toMatch(/ · Hollowed 🕯️$/);
    expect(shown.owner).toBe(`${c.name}. 0 of ${String(c.tiles.length)} tiles restored.`);
    expect(shown.about).toBe(info.about);
    // Someone's land keeps saying whose it is.
    const owned = { ...tile, ownerUserId: userId(1) };
    expect(
      hollowedTileInfo(
        describeTile(owned, () => undefined, userId(1)),
        owned,
        view,
      ).owner,
    ).toBe('Your land.');
    // Any other tile is left as it was.
    const wild = view.tiles.find((t) => !t.communityId && t.homeSlot === null);
    if (!wild) throw new Error('no wild tile');
    const plain = describeTile(wild, () => undefined, userId(1));
    expect(hollowedTileInfo(plain, wild, view)).toBe(plain);
  });
});

describe('a won village (#306 PR 3)', () => {
  const view = testView(1);
  const [first, ...rest] = view.communities ?? [];
  if (!first) throw new Error('no village');
  const ring = new Set([first.square, ...hexNeighbors(first.square)].map(hexKey));
  /** Village one won by player 1: its ring is their home land, marked as the village's. */
  const won: MapView = {
    ...view,
    tiles: view.tiles.map((t) =>
      ring.has(hexKey(t)) && t.homeSlot === null
        ? { ...t, ownerUserId: userId(1), homeSlot: 0, communityId: first.id }
        : t,
    ),
    communities: [
      { ...first, name: 'Bramble Glen', ownerUserId: userId(1), named: false },
      ...rest,
    ],
  };
  const square = won.tiles.find((t) => hexKey(t) === hexKey(first.square))!;
  const ringTile = won.tiles.find(
    (t) => ring.has(hexKey(t)) && hexKey(t) !== hexKey(first.square),
  )!;

  it('flies its name like a home, not the Hollowed flag', () => {
    expect(communityFlagLabel(won.communities![0]!)).toBe('🏡 Bramble Glen');
  });

  it('heads its square as a second Heart Seed and its ring as part of that home', () => {
    const seed = hollowedTileInfo(
      describeTile(square, () => undefined, userId(1)),
      square,
      won,
      userId(1),
    );
    expect(seed.title).toBe('Bramble Glen · Heart Seed 🌱');
    expect(seed.owner).toBe(COMMUNITY_TEXT.mySeed);
    const tile = hollowedTileInfo(
      describeTile(ringTile, () => undefined, userId(1)),
      ringTile,
      won,
      userId(1),
    );
    expect(tile.title).toMatch(/ · Bramble Glen 🏡$/);
    expect(tile.owner).toBe(COMMUNITY_TEXT.myRing);
    // Someone else sees whose village it is.
    const theirs = hollowedTileInfo(
      describeTile(square, () => undefined, userId(2)),
      square,
      won,
      userId(2),
    );
    expect(theirs.owner).toBe(
      `${won.members[0]!.user.username}'s village. Nobody can ever take it!`,
    );
  });

  it('draws its square as a Heart Seed, and leaves my first home the only home base', () => {
    expect(villageSeeds(won).map((c) => c.square)).toEqual([first.square]);
    const homes = findHomeBases(won.tiles).filter((h) => h.seed.ownerUserId === userId(1));
    expect(homes).toHaveLength(1);
    expect(hexKey(homes[0]!.seed)).not.toBe(hexKey(first.square));
  });

  it('says what its perk does (PR 3b)', () => {
    expect(perkLine('workshop')).toBe('🛠️ Workshop: one more Factory batch');
    expect(perkLine('bakery')).toBe('🥧 Bakery: Treats every morning');
    expect(perkLine('watchtower')).toBe('🗼 Watchtower: your guards fight 2 levels stronger');
  });

  it('draws a tile restored on its own in colour again', () => {
    const t = first.tiles[1]!;
    const partly = {
      ...view,
      communities: [{ ...first, restored: 1, restoredTiles: [t] }, ...rest],
    };
    expect(greyTiles(partly).has(hexKey(t))).toBe(false);
    expect(greyTiles(partly).has(hexKey(first.square))).toBe(true);
  });
});
