import {
  findAvoidedWords,
  hexKey,
  hexNeighbors,
  TERRITORY_RULES,
  type MapView,
  type PublicTile,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import { shieldUntil, territoryAction } from './territory-action.js';
import { TERRITORY_TEXT } from './territory-screen.js';

const ME = userId(1);
// Three days after everyone joined (test-view), so nobody's new-player shield is on.
const NOW = Date.parse('2026-10-05T12:00:00.000Z');

const status = (over: Partial<TerritoryStatus> = {}): TerritoryStatus => ({
  attemptsLeft: 7,
  attemptsPerDay: 10,
  shieldUntil: null,
  defenders: [],
  squishies: [],
  speciesDefs: [],
  now: new Date(NOW).toISOString(),
  ...over,
});

/** Player 1's map, with a wild tile next to their home ring (and a few changes). */
function setup(change: (tile: PublicTile) => Partial<PublicTile> = () => ({})) {
  const base = testView(2);
  const mine = new Set(base.tiles.filter((t) => t.ownerUserId === ME).map(hexKey));
  const edge = base.tiles.find(
    (t) =>
      t.ownerUserId === null &&
      t.homeSlot === null &&
      hexNeighbors(t).some((n) => mine.has(hexKey(n))),
  )!;
  const view: MapView = {
    ...base,
    tiles: base.tiles.map((t) => (t === edge ? { ...t, ...change(t) } : t)),
  };
  const tile = view.tiles.find((t) => t.q === edge.q && t.r === edge.r)!;
  return { view, tile };
}

describe('territoryAction', () => {
  it('offers Claim on wild land next to yours, with tries left', () => {
    const { view, tile } = setup();
    expect(territoryAction(tile, view, ME, status(), NOW)).toEqual({
      kind: 'claim',
      attemptsLeft: 7,
    });
  });

  it('offers Challenge on a neighbour’s land, unless challenges are off', () => {
    const { view, tile } = setup(() => ({ ownerUserId: userId(2) }));
    expect(territoryAction(tile, view, ME, status(), NOW).kind).toBe('challenge');
    const off = { ...view, map: { ...view.map, pvpMode: 'off' as const } };
    expect(territoryAction(tile, off, ME, status(), NOW).kind).toBe('pvp-off');
  });

  it('shows a resting tile, and no tries once they’re used up', () => {
    const resting = setup(() => ({ cooldownUntil: new Date(NOW + 60_000).toISOString() }));
    expect(territoryAction(resting.tile, resting.view, ME, status(), NOW).kind).toBe('resting');
    const rested = setup(() => ({ cooldownUntil: new Date(NOW - 1).toISOString() }));
    expect(territoryAction(rested.tile, rested.view, ME, status(), NOW).kind).toBe('claim');
    expect(
      territoryAction(rested.tile, rested.view, ME, status({ attemptsLeft: 0 }), NOW).kind,
    ).toBe('no-tries');
  });

  it('offers guards on your own land, never on home bases or far away', () => {
    const { view, tile } = setup(() => ({ ownerUserId: ME }));
    const posted = status({ defenders: [{ q: tile.q, r: tile.r, squishyIds: ['a', 'b'] }] });
    expect(territoryAction(tile, view, ME, posted, NOW)).toEqual({
      kind: 'watch',
      squishyIds: ['a', 'b'],
    });
    const home = view.tiles.find((t) => t.ownerUserId === ME && t.homeSlot !== null)!;
    expect(territoryAction(home, view, ME, status(), NOW).kind).toBe('none');
    const theirHome = view.tiles.find((t) => t.ownerUserId === userId(2))!;
    expect(territoryAction(theirHome, view, ME, status(), NOW).kind).toBe('none');
    const far = view.tiles.find((t) => t.q === 0 && t.r === 0)!;
    expect(territoryAction(far, view, ME, status(), NOW).kind).toBe('too-far');
  });

  it('explains a new Keeper’s shield on their land instead of offering Challenge (#147)', () => {
    const { view, tile } = setup(() => ({ ownerUserId: userId(2), defenders: 1 }));
    const joined = Date.parse(view.members[1]!.joinedAt);
    const shieldMs = TERRITORY_RULES.newPlayerShieldHours * 60 * 60 * 1000;
    const ends = new Date(joined + shieldMs).toISOString();
    // They joined today: shielded, with the moment the server's shield ends.
    expect(territoryAction(tile, view, ME, status(), joined + 60_000)).toEqual({
      kind: 'shielded',
      until: ends,
    });
    expect(shieldUntil(tile, view, joined + 60_000)).toBe(ends);
    // The shield beats a resting tile: the land can't be challenged either way.
    const resting = setup(() => ({
      ownerUserId: userId(2),
      cooldownUntil: new Date(joined + 120_000).toISOString(),
    }));
    expect(territoryAction(resting.tile, resting.view, ME, status(), joined + 60_000).kind).toBe(
      'shielded',
    );
    // Once it's over, Challenge is back.
    expect(territoryAction(tile, view, ME, status(), joined + shieldMs).kind).toBe('challenge');
    expect(shieldUntil(tile, view, joined + shieldMs)).toBeNull();
    // Challenges off still wins: there's nothing to shield from.
    const off = { ...view, map: { ...view.map, pvpMode: 'off' as const } };
    expect(territoryAction(tile, off, ME, status(), joined + 60_000).kind).toBe('pvp-off');
    // Wild land has no shield.
    expect(shieldUntil({ ownerUserId: null }, view, joined)).toBeNull();
  });

  it('says land that isn’t next to yours is too far, shielded or not', () => {
    const { view } = setup();
    const far = view.tiles.find((t) => t.q === 0 && t.r === 0)!;
    expect(territoryAction(far, view, ME, status(), NOW).kind).toBe('too-far');
    const theirs = { ...far, ownerUserId: userId(2) };
    const joined = Date.parse(view.members[1]!.joinedAt);
    expect(territoryAction(theirs, view, ME, status(), joined + 60_000).kind).toBe('shielded');
    expect(territoryAction(theirs, view, ME, status(), NOW + 365 * 24 * 60 * 60 * 1000).kind).toBe(
      'too-far',
    );
  });

  it('offers nothing before it knows who you are and your tries', () => {
    const { view, tile } = setup();
    expect(territoryAction(tile, view, null, status(), NOW).kind).toBe('none');
    expect(territoryAction(tile, view, ME, null, NOW).kind).toBe('none');
  });
});

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'function'
      ? [String((value as (...args: unknown[]) => unknown)('Pip', 2))]
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(strings)
        : [];

describe('territory words (style guide)', () => {
  it('uses none of the avoided words, and says Claim and Challenge', () => {
    const texts = strings(TERRITORY_TEXT);
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
    expect(TERRITORY_TEXT.claim).toBe('Claim');
    expect(TERRITORY_TEXT.challenge).toBe('Challenge');
  });

  it('keeps buttons short', () => {
    for (const label of [
      TERRITORY_TEXT.claim,
      TERRITORY_TEXT.challenge,
      TERRITORY_TEXT.pick,
      TERRITORY_TEXT.save,
      TERRITORY_TEXT.cancel,
    ]) {
      expect(label.split(' ').length).toBeLessThanOrEqual(2);
    }
  });
});
