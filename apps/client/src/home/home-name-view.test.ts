import { HomeNameSchema, NAMING_RULES, type HomeNaming } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { findHomeBases } from '../map/map-layout.js';
import { describeTile } from '../map/tile-info.js';
import { testView, userId } from '../map/test-view.js';
import {
  HOME_NAME_TEXT,
  homeFlags,
  nameCard,
  nameIdeas,
  nameRowBadge,
  nameRowLabel,
  ringTerrains,
  seedName,
  TERRAIN_IDEAS,
} from './home-name-view.js';

const kinds = (built: number): HomeNaming['kinds'] =>
  (['hearthfire', 'habitat', 'training-grounds', 'fence', 'factory'] as const).map((kind, i) => ({
    kind,
    built: i < built,
  }));

const naming = (extra: Partial<HomeNaming> = {}): HomeNaming => ({
  name: null,
  unlocked: false,
  kinds: kinds(3),
  caught: 7,
  need: 10,
  renameOpen: false,
  ...extra,
});

/** Style guide §9: words that never appear in player-facing text. */
const AVOIDED =
  /\b(die|dead|death|kill|faint|hurt|injure|wound|bleed|blood|damage|destroy|crush|slash|stab|bite|attack|weapon|enemy|hate|stupid|loser)\b/i;

describe('the "Name your home" row (#306)', () => {
  it('shows the gate progress while locked, from the server numbers', () => {
    expect(nameRowLabel(naming())).toBe('Name your home 🔒 · 3/5 · 7/10');
    expect(nameRowLabel(naming({ kinds: kinds(1).slice(0, 4), caught: 2, need: 12 }))).toBe(
      'Name your home 🔒 · 1/4 · 2/12',
    );
    expect(nameRowBadge(naming())).toBeNull();
    expect(nameCard(naming())).toBe('locked');
  });

  it('invites a name once unlocked', () => {
    const open = naming({ unlocked: true, kinds: kinds(5), caught: 10, renameOpen: true });
    expect(nameRowLabel(open)).toBe('Name your home 🏡');
    expect(nameRowBadge(open)).toBeNull();
    expect(nameCard(open)).toBe('name');
  });

  it('shows the name, and a badge when the Heart Seed grew', () => {
    const named = naming({ name: 'Puddle Corner', unlocked: true, kinds: kinds(5), caught: 10 });
    expect(nameRowLabel(named)).toBe('🏡 Puddle Corner');
    expect(nameRowBadge(named)).toBeNull();
    expect(nameCard(named)).toBe('named');
    const grew = { ...named, renameOpen: true };
    expect(nameRowBadge(grew)).toBe('🌱 Your Heart Seed grew! New name?');
    expect(nameCard(grew)).toBe('name');
  });

  it('says the card copy from the rules, kindly', () => {
    expect(HOME_NAME_TEXT.lockedLine(10)).toBe(
      'Build one of each and befriend 10 squishies to name your home!',
    );
    expect(HOME_NAME_TEXT.note(NAMING_RULES.maxLength)).toBe(
      'Tap an idea, or type your own. Up to 16 letters. Pick a new name whenever your Heart Seed grows!',
    );
    const all = Object.values(HOME_NAME_TEXT)
      .map((v) => (typeof v === 'function' ? (v as (a: number, b: number) => string)(3, 5) : v))
      .join(' ');
    expect(all).not.toMatch(AVOIDED);
  });
});

describe('nameIdeas (#306)', () => {
  it("offers the Keeper's Meadow, then two from the home ring's land", () => {
    expect(nameIdeas('Mia', ['lake', 'lake', 'meadow', 'forest'])).toEqual([
      "Mia's Meadow",
      'Puddle Corner',
      'Sunny Patch',
    ]);
  });

  it('gives two ideas from one kind of land', () => {
    expect(nameIdeas('Mia', ['hills', 'hills'])).toEqual([
      "Mia's Meadow",
      'Breezy Hilltop',
      'Bumpy Burrow',
    ]);
  });

  it('always offers three, even with no land or name to go on', () => {
    expect(nameIdeas(null, [])).toHaveLength(3);
    expect(nameIdeas('', ['volcano'])).toEqual(['Sunny Patch', 'Cozy Corner', 'Snug Nook']);
  });

  it('keeps every idea short enough and within the name rules', () => {
    const long = nameIdeas('Bartholomew_Jones', ['old-forest', 'pumpkin-fields']);
    expect(long).toHaveLength(3);
    for (const idea of long) {
      expect(idea.length).toBeLessThanOrEqual(NAMING_RULES.maxLength);
      expect(HomeNameSchema.safeParse(idea).success).toBe(true);
    }
    // Too long for a Meadow, short enough for a Nook; underscores read as spaces.
    expect(nameIdeas('Bart_Jo', ['lake'])[0]).toBe("Bart Jo's Meadow");
    expect(nameIdeas('Bartholo', ['lake'])[0]).toBe("Bartholo's Nook");
    expect(nameIdeas('Bartholomew_Jones', ['lake'])[0]).toBe('Puddle Corner');
    expect(nameIdeas('Mia', ['lake'], 12)).toEqual(["Mia's Meadow", 'Splashy Cove', 'Sunny Patch']);
  });

  it('has only names the rules take, and kind ones', () => {
    for (const ideas of Object.values(TERRAIN_IDEAS)) {
      for (const idea of ideas) {
        expect(HomeNameSchema.safeParse(idea).success).toBe(true);
        expect(idea.length).toBeLessThanOrEqual(NAMING_RULES.maxLength);
        expect(idea).not.toMatch(AVOIDED);
        expect(idea).not.toMatch(/hollow/i);
      }
    }
  });
});

describe('ringTerrains (#306)', () => {
  it("reads my home ring's six tiles, not the Heart Seed or anyone else's", () => {
    const view = testView(2);
    const mine = ringTerrains(view, userId(1));
    expect(mine).toHaveLength(6);
    const seed = findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === userId(1))?.seed;
    const ring = view.tiles.filter(
      (t) => t.homeSlot === seed?.homeSlot && !(t.q === seed.q && t.r === seed.r),
    );
    expect(mine).toEqual(ring.map((t) => t.terrain));
    expect(ringTerrains(view, userId(9))).toEqual([]);
    expect(ringTerrains(null, userId(1))).toEqual([]);
  });
});

describe('home flags and the Heart Seed title (#306)', () => {
  const view = testView(3);
  const named = {
    ...view,
    members: view.members.map((m, i) => (i === 1 ? { ...m, homeName: 'Puddle Corner' } : m)),
  };

  it("flies a flag over each named member's Heart Seed only", () => {
    expect(homeFlags(view)).toEqual([]);
    const flags = homeFlags(named);
    const seed = findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === userId(2))?.seed;
    expect(flags).toEqual([{ userId: userId(2), label: '🏡 Puddle Corner', tile: seed }]);
  });

  it('titles a named Heart Seed, and leaves the rest of its ring as it was', () => {
    const seed = findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === userId(2))?.seed;
    if (!seed) throw new Error('no seed');
    expect(seedName(named, seed)).toBe('Puddle Corner');
    const lookup = (id: string) => named.members.find((m) => m.user.id === id);
    expect(describeTile(seed, lookup, userId(1), [], null, seedName(named, seed)).title).toBe(
      'Puddle Corner · Heart Seed 🌱',
    );
    const ringTile = named.tiles.find(
      (t) => t.homeSlot === seed.homeSlot && !(t.q === seed.q && t.r === seed.r),
    );
    if (!ringTile) throw new Error('no ring');
    expect(seedName(named, ringTile)).toBeNull();
    // An unnamed home's seed keeps its terrain title.
    const other = findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === userId(1))?.seed;
    if (!other) throw new Error('no seed');
    expect(seedName(named, other)).toBeNull();
  });
});
