import { RARE_FIND_TIERS, type Rarity } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import cheerCss from './befriend-cheer.css?raw';
import { BEFRIEND_CHEER, revealStep } from './battle-config.js';
import { cheerFor, heartSpots } from './befriend-cheer.js';

type CheerBattle = Parameters<typeof cheerFor>[0];

/** A wild battle, over, the player (side `a`) having befriended `wildSpecies`. */
function befriendedBattle(
  wildSpecies: string,
  over: { firstEver?: boolean; reason?: string; winner?: string; kind?: string } = {},
): CheerBattle {
  const side = (speciesId: string) => ({ active: 0, squishies: [{ speciesId }] });
  return {
    kind: over.kind ?? 'wild',
    mySide: 'a',
    ...(over.firstEver !== undefined && { firstEver: over.firstEver }),
    view: {
      phase: {
        type: 'over',
        result: { reason: over.reason ?? 'captured', winner: over.winner ?? 'a' },
      },
      sides: { a: side('mine'), b: side(wildSpecies) },
    },
  } as unknown as CheerBattle;
}

const species = new Map<string, { rarity: Rarity }>(
  (['common', 'rare', 'epic', 'legendary', 'mythic', 'secret'] as const).map((r) => [
    r,
    { rarity: r },
  ]),
);

describe('cheerFor (#391)', () => {
  it('celebrates a rare-or-better friend in its tier’s colours and words', () => {
    expect(cheerFor(befriendedBattle('epic', { firstEver: true }), species)).toEqual({
      rare: { rarity: 'epic', label: 'Epic', scale: RARE_FIND_TIERS.epic!.scale },
      firstEver: true,
    });
    expect(cheerFor(befriendedBattle('secret', { firstEver: false }), species)?.rare?.label).toBe(
      'Special',
    );
    // No Mythic row yet: at least the Legendary card.
    expect(cheerFor(befriendedBattle('mythic'), species)?.rare).toMatchObject({
      rarity: 'mythic',
      label: 'Legendary',
    });
  });

  it('puts "First ever!" on any first friend of its kind, and leaves a plain repeat alone', () => {
    expect(cheerFor(befriendedBattle('common', { firstEver: true }), species)).toEqual({
      rare: null,
      firstEver: true,
    });
    expect(cheerFor(befriendedBattle('common', { firstEver: false }), species)).toBeNull();
    // A server from before #391 sends nothing: no sticker.
    expect(cheerFor(befriendedBattle('rare'), species)?.firstEver).toBe(false);
  });

  it('only cheers a wild squishy the player befriended', () => {
    expect(cheerFor(befriendedBattle('rare', { reason: 'tuckered-out' }), species)).toBeNull();
    expect(cheerFor(befriendedBattle('rare', { winner: 'b' }), species)).toBeNull();
    expect(cheerFor(befriendedBattle('rare', { kind: 'tile' }), species)).toBeNull();
  });
});

describe('the hearts (#391)', () => {
  it('fall in more numbers for rarer friends', () => {
    const counts = [1, 2, 3].map((scale) => revealStep(BEFRIEND_CHEER.hearts, scale));
    expect([...counts].sort((x, y) => x - y)).toEqual(counts);
    expect(BEFRIEND_CHEER.calmHearts).toBeLessThan(counts[0]!);
  });

  it('come to rest across the screen, between the pills and the card', () => {
    const band = { top: 150, bottom: 520, width: 390 };
    const spots = heartSpots(20, band, 9);
    expect(spots).toHaveLength(20);
    for (const h of spots) {
      expect(h.x).toBeGreaterThanOrEqual(0.08 * band.width - 1);
      expect(h.x).toBeLessThanOrEqual(0.92 * band.width + 1);
      expect(h.y).toBeGreaterThanOrEqual(band.top);
      expect(h.y).toBeLessThanOrEqual(band.bottom);
    }
    expect(heartSpots(5, band, 9)).toEqual(heartSpots(5, band, 9));
  });

  it('animates only transform and opacity (mobile budget)', () => {
    const frames = cheerCss.match(/@keyframes[^{]+\{([\s\S]*?\n)\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    const props = new Set(
      frames.flatMap((f) => [...f.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1])),
    );
    expect([...props].sort()).toEqual(['opacity', 'transform']);
  });
});
