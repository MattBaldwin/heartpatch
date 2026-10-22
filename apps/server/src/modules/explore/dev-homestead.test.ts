import { CLEARED_TERRAIN, extraNodes, GAME_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { pickDevHomestead, type DevHomesteadCandidate } from './dev-homestead.js';

const SEED = 'issue-566';

/** What the next map read (`seedExtraNodes`) plants on a spotless tile of mine. */
const regrown = (tile: DevHomesteadCandidate) =>
  extraNodes([{ ...tile, homeSlot: null, nodeResource: null }], GAME_DATA.terrains, SEED);

// Forests in a row: a Greens spot grows back on about one in four (#238).
const forests: DevHomesteadCandidate[] = Array.from({ length: 40 }, (_, i) => ({
  q: i - 20,
  r: 3,
  terrain: 'forest',
}));
const grows = forests.filter((t) => regrown(t).length > 0);
const stays = forests.filter((t) => regrown(t).length === 0);

describe('pickDevHomestead (#566)', () => {
  it('has forests both ways under this seed', () => {
    expect(grows.length).toBeGreaterThanOrEqual(2);
    expect(stays.length).toBeGreaterThanOrEqual(1);
  });

  it("skips a forest the next map read plants a Greens spot on, so the Factory isn't held back", () => {
    // The flake: the first free forest took a spot back at the next map read,
    // and the Build sheet said "Clear this land first".
    const picked = pickDevHomestead([grows[0]!, stays[0]!], {}, SEED);
    expect(picked).toEqual({ tile: stays[0], terrain: 'forest' });
    expect(regrown({ ...picked!.tile, terrain: picked!.terrain })).toEqual([]);
  });

  it('clears one when every tile would grow a spot back', () => {
    const picked = pickDevHomestead([grows[0]!, grows[1]!], {}, SEED);
    expect(picked).toEqual({ tile: grows[0], terrain: CLEARED_TERRAIN });
    expect(regrown({ ...picked!.tile, terrain: picked!.terrain })).toEqual([]);
  });

  it('keeps the first buildable land as it is when nothing grows back', () => {
    const meadow = { q: 0, r: 2, terrain: 'meadow' };
    expect(pickDevHomestead([meadow, stays[0]!], {}, SEED)).toEqual({
      tile: meadow,
      terrain: 'meadow',
    });
  });

  it('keeps Old Forest as it is, and clears a lake when nothing else stays spotless (#429, #601 Q1)', () => {
    const old = { q: 1, r: 1, terrain: 'old-forest' };
    const lake = { q: 2, r: 0, terrain: 'lake' };
    expect(pickDevHomestead([lake, old], {}, SEED)).toEqual({ tile: old, terrain: 'old-forest' });
    // Every lake grows its well back: cleared, it never does.
    expect(pickDevHomestead([lake], {}, SEED)).toEqual({ tile: lake, terrain: CLEARED_TERRAIN });
    expect(pickDevHomestead([{ q: 3, r: 0, terrain: 'junipers-gap' }], {}, SEED)).toBeNull();
  });

  it('with a spot asked for, takes the first tile: the spot is there anyway', () => {
    expect(pickDevHomestead([grows[0]!, stays[0]!], { nodeResource: 'timber' }, SEED)).toEqual({
      tile: grows[0],
      terrain: 'forest',
    });
  });

  it('with land asked for, prefers one that stays spotless, else takes the first', () => {
    expect(pickDevHomestead([grows[0]!, stays[0]!], { terrain: 'forest' }, SEED)).toEqual({
      tile: stays[0],
      terrain: 'forest',
    });
    // Every lake has its well (#238).
    expect(pickDevHomestead([grows[0]!, stays[0]!], { terrain: 'lake' }, SEED)).toEqual({
      tile: grows[0],
      terrain: 'lake',
    });
  });
});
