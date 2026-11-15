import { describe, expect, it } from 'vitest';
import { COMPUTER_MATES } from '../data/server/computer-mates.js';
import { hexDistance, hexKey, hexSpiral, type Hex } from '../hex/index.js';
import { deriveSeed, Rng } from '../rng/index.js';
import { TRADING_POST_TERRAIN } from '../territory/reach.js';
import {
  claimTarget,
  mateLandCap,
  mateTeamLevel,
  nextIntent,
  type MateView,
  type MateViewTile,
} from './policy.js';

const rules = COMPUTER_MATES.rules;
const persona = COMPUTER_MATES.personas[0]!;
const MATE = 'mate';
const KID = 'kid';
const KID_SEED: Hex = { q: 0, r: 0 };
const MATE_SEED: Hex = { q: 8, r: 0 };

/** A radius-10 patch: the kid's home at the middle, the mate's 8 tiles east. */
function patch(extra: (t: MateViewTile) => Partial<MateViewTile> = () => ({})): MateViewTile[] {
  return hexSpiral({ q: 0, r: 0 }, 10).map((h) => {
    const base: MateViewTile = {
      q: h.q,
      r: h.r,
      terrain: 'meadow',
      ownerUserId: null,
      homeSlot: null,
    };
    if (hexDistance(h, KID_SEED) <= 1) return { ...base, ownerUserId: KID, homeSlot: 0 };
    if (hexDistance(h, MATE_SEED) <= 1) return { ...base, ownerUserId: MATE, homeSlot: 1 };
    return { ...base, ...extra(base) };
  });
}

const view = (tiles: MateViewTile[], over: Partial<MateView> = {}): MateView => ({
  userId: MATE,
  tiles,
  kids: [{ userId: KID, heartSeed: KID_SEED }],
  seats: 2,
  claimsToday: 0,
  catchUp: false,
  fires: [],
  built: [],
  guarded: [],
  freeSquishies: 3,
  ...over,
});

const rngAt = (step: number) => Rng.fromSeed(deriveSeed('mate-seed', step));

describe('computer mates policy', () => {
  it('nextIntent is deterministic for a seed and step', () => {
    const v = view(patch());
    for (let step = 0; step < 20; step++) {
      expect(nextIntent(v, persona, rules, rngAt(step))).toEqual(
        nextIntent(v, persona, rules, rngAt(step)),
      );
    }
  });

  it('claims next to its land, toward the kid, never inside the kid buffer', () => {
    const target = claimTarget(view(patch()), rules);
    expect(target).not.toBeNull();
    expect(hexDistance(target!, MATE_SEED)).toBe(2);
    expect(hexDistance(target!, KID_SEED)).toBeGreaterThan(rules.kidHomeBuffer);
    // Leaning toward the kid: the westmost ring-2 tile around its home.
    expect(target!.q).toBeLessThan(MATE_SEED.q);
  });

  it('never claims a post, water or grey village tile', () => {
    const banned = (t: MateViewTile): Partial<MateViewTile> =>
      hexDistance(t, MATE_SEED) === 2
        ? t.q % 3 === 0
          ? { terrain: TRADING_POST_TERRAIN }
          : t.q % 3 === 1
            ? { terrain: 'wild-lake' }
            : { communityId: 'v1' }
        : {};
    expect(claimTarget(view(patch(banned)), rules)).toBeNull();
  });

  it('never claims within the kid buffer even when that is all that is left', () => {
    // The mate's home right next to the kid's buffer, everything else taken.
    const tiles = patch((t) =>
      hexDistance(t, KID_SEED) > rules.kidHomeBuffer ? { ownerUserId: 'someone' } : {},
    );
    const near = tiles.map((t) =>
      hexDistance(t, { q: 3, r: 0 }) === 0 ? { ...t, ownerUserId: MATE } : t,
    );
    const target = claimTarget(view(near), rules);
    expect(target).toBeNull();
  });

  it('stops claiming at the land cap', () => {
    const tiles = patch();
    const cap = mateLandCap(tiles, 2, rules);
    // Give the mate exactly `cap` outer tiles, nearest its home first.
    const outer = tiles
      .filter((t) => t.homeSlot === null && hexDistance(t, KID_SEED) > 3)
      .sort((a, b) => hexDistance(a, MATE_SEED) - hexDistance(b, MATE_SEED))
      .slice(0, cap)
      .map(hexKey);
    const owned = new Set(outer);
    const full = tiles.map((t) => (owned.has(hexKey(t)) ? { ...t, ownerUserId: MATE } : t));
    const fires = full.filter((t) => owned.has(hexKey(t))).slice(0, Math.floor(cap / 6));
    for (let step = 0; step < 30; step++) {
      const intent = nextIntent(
        view(full, { fires, freeSquishies: 0 }),
        persona,
        rules,
        rngAt(step),
      );
      expect(intent?.kind).not.toBe('claim');
    }
  });

  it('respects claimsPerDay', () => {
    const v = view(patch(), { claimsToday: persona.claimsPerDay, freeSquishies: 0 });
    expect(nextIntent(v, persona, rules, rngAt(1))).toBeNull();
  });

  it('lights one fire per fireEveryTiles, on its darkest empty tile', () => {
    const tiles = patch();
    const outer = tiles
      .filter((t) => hexDistance(t, MATE_SEED) === 2)
      .slice(0, rules.fireEveryTiles)
      .map(hexKey);
    const owned = new Set(outer);
    const mine = tiles.map((t) => (owned.has(hexKey(t)) ? { ...t, ownerUserId: MATE } : t));
    const intent = nextIntent(view(mine), persona, rules, rngAt(0));
    expect(intent?.kind).toBe('fire');
    expect(owned.has(hexKey(intent as Hex))).toBe(true);
    // One fire is enough for six tiles.
    const lit = nextIntent(view(mine, { fires: [intent as Hex] }), persona, rules, rngAt(0));
    expect(lit?.kind).not.toBe('fire');
  });

  it('guards only border tiles that face a kid, up to guardedTiles', () => {
    // Mate land running west to touch the kid's land.
    const tiles = patch().map((t) =>
      t.r === 0 && t.q >= 2 && t.q <= 6 ? { ...t, ownerUserId: MATE } : t,
    );
    const guardOnly = { ...persona, weights: { ...persona.weights, claim: 0 } };
    const intent = nextIntent(view(tiles, { fires: [{ q: 4, r: 0 }] }), guardOnly, rules, rngAt(0));
    expect(intent).toEqual({ kind: 'guard', q: 2, r: 0 });
    const full = view(tiles, {
      fires: [{ q: 4, r: 0 }],
      guarded: [
        { q: 2, r: 0 },
        { q: 9, r: 9 },
      ],
    });
    expect(nextIntent(full, guardOnly, rules, rngAt(0))).toBeNull();
  });

  it('a catch-up step only claims', () => {
    const tiles = patch();
    const outer = new Set(
      tiles
        .filter((t) => hexDistance(t, MATE_SEED) === 2)
        .slice(0, 7)
        .map(hexKey),
    );
    const mine = tiles.map((t) => (outer.has(hexKey(t)) ? { ...t, ownerUserId: MATE } : t));
    for (let step = 0; step < 20; step++) {
      const intent = nextIntent(view(mine, { catchUp: true }), persona, rules, rngAt(step));
      expect(intent === null || intent.kind === 'claim').toBe(true);
    }
  });

  it("a mate's levels track the kid's Partner inside the offset", () => {
    for (const p of COMPUTER_MATES.personas) {
      for (const partner of [1, 5, 30, 60]) {
        const level = mateTeamLevel(partner, p);
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(partner);
        if (partner > 3) expect(partner - level).toBe(-p.levelOffset);
      }
    }
  });
});
