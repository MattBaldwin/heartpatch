import { COMMUNITY_RULES, hexKey, type CommunityView } from '@heartpatch/shared';
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
    expect(panel.lines).toEqual([
      'Grey, quiet and a little spooky. Rare squishies love quiet places…',
      '🛠️ Workshop village: One more Factory batch slot.',
      '🔗 Your land touches it. Explore by day, restore with Heartdust!',
    ]);
    expect(panel.open).toBe(true);
    // Nothing hooked up yet (PR 1): it says they're coming.
    expect(panel.note).toBe('Exploring and restoring open soon! 🕯️');
    expect(communityPanel(village(), 'old-forest', false, true).note).toBeNull();
  });

  it('says how to get there when it is away', () => {
    const far = communityPanel(village({ reach: 'away', distance: 4 }), 'meadow', false);
    expect(far.lines.at(-1)).toBe('🧭 4 tiles from your land. Claim land toward it to explore!');
    expect(far.open).toBe(false);
    expect(far.note).toBeNull();
    const near = communityPanel(village({ reach: 'away', distance: 1 }), 'meadow', false);
    expect(near.lines.at(-1)).toBe('🧭 1 tile from your land. Claim land toward it to explore!');
    expect(communityPanel(village({ reach: null }), 'meadow', false).lines.at(-1)).toBe(
      COMMUNITY_TEXT.noLand,
    );
  });

  it('closes at night, whatever the reach', () => {
    for (const reach of ['touching', 'away', null] as const) {
      const panel = communityPanel(village({ reach, distance: reach === 'away' ? 2 : null }), 'hills', true);
      expect(panel.lines.at(-1)).toBe('Open by day only. Too spooky after dark!');
      expect(panel.open).toBe(false);
      expect(panel.note).toBeNull();
    }
  });

  it('names every kind with its emoji and perk', () => {
    for (const kind of COMMUNITY_RULES.kinds) {
      expect(kindLine(kind.id)).toBe(`${kind.emoji} ${kind.name} village: ${kind.perk}`);
    }
  });

  it('keeps every line short and free of avoided words (style guide §2, §9)', () => {
    const avoided = /\b(die|dead|death|kill|faint|hurt|injure|wound|bleed|blood|damage|destroy|crush|slash|stab|bite|attack|weapon|enemy|hate|stupid|loser)\b/i;
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
    expect(hollowedTileInfo(describeTile(owned, () => undefined, userId(1)), owned, view).owner).toBe(
      'Your land.',
    );
    // Any other tile is left as it was.
    const wild = view.tiles.find((t) => !t.communityId && t.homeSlot === null);
    if (!wild) throw new Error('no wild tile');
    const plain = describeTile(wild, () => undefined, userId(1));
    expect(hollowedTileInfo(plain, wild, view)).toBe(plain);
  });

  it('works out reach for the viewer as the server does', () => {
    for (const c of villages) {
      expect(c.reach === null || c.reach === 'touching' || c.reach === 'away').toBe(true);
      if (c.reach === 'away') expect(c.distance).toBeGreaterThanOrEqual(1);
    }
  });
});
