import {
  findAvoidedWords,
  hexKey,
  edgeNeighbor,
  hexNeighbors,
  TERRITORY_RULES,
  type PublicFence,
  type MapView,
  type PublicTile,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import { fenceToBreak, shieldUntil, territoryAction, watchInTheDark } from './territory-action.js';
import { formatWait } from '../inventory/game-clock.js';
import { TERRITORY_TEXT } from './territory-screen.js';

const ME = userId(1);
// Three days after everyone joined (test-view), so nobody's new-player shield is on.
const NOW = Date.parse('2026-10-05T12:00:00.000Z');

const status = (over: Partial<TerritoryStatus> = {}): TerritoryStatus => ({
  attemptsLeft: 7,
  attemptsPerDay: 10,
  triesResetAt: '2026-10-06T06:00:00.000Z',
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

const RIVAL = userId(2);
const segment = (edge: number, hp = 70): PublicFence => ({
  id: `0190a8c4-0000-7000-8000-00000000060${String(edge)}`,
  edge,
  buildingId: 'hedge',
  level: 1,
  hp,
  maxHp: 70,
});
/** Edges of `tile` that face player 1's land. */
const facingMe = (view: MapView, tile: PublicTile) => {
  const mine = new Set(view.tiles.filter((t) => t.ownerUserId === ME).map(hexKey));
  return [0, 1, 2, 3, 4, 5].filter((e) => mine.has(hexKey(edgeNeighbor(tile, e as 0))));
};

describe('challenging a fenced tile (#203)', () => {
  it('breaks the weakest segment facing my land first, once it is fenced all round', () => {
    const { view, tile } = setup(() => ({ ownerUserId: RIVAL }));
    const toMe = facingMe(view, tile);
    expect(toMe.length).toBeGreaterThan(0);
    const weakEdge = toMe[0] ?? 0;
    // A weaker segment that doesn't face me isn't the one I fight.
    const away = [0, 1, 2, 3, 4, 5].find((e) => !toMe.includes(e)) ?? 5;
    const fences = [0, 1, 2, 3, 4, 5].map((e) =>
      segment(e, e === weakEdge ? 40 : e === away ? 10 : 70),
    );
    const fenced = { ...tile, fences };
    const fencedView = { ...view, tiles: view.tiles.map((t) => (t === tile ? fenced : t)) };
    const action = territoryAction(fenced, fencedView, ME, status(), NOW);
    expect(action).toMatchObject({ kind: 'challenge', fence: { edge: weakEdge, hp: 40 } });
    // A gap anywhere: not fenced, a plain challenge.
    const gappy = { ...tile, fences: fences.slice(1) };
    expect(fenceToBreak(gappy, view, ME)).toBeNull();
    // My own tile, or wild land, has nothing to break.
    expect(fenceToBreak({ ...fenced, ownerUserId: ME }, view, ME)).toBeNull();
    expect(fenceToBreak({ ...fenced, ownerUserId: null }, view, ME)).toBeNull();
  });

  it('offers Keep going after I broke the fence, despite the rest and no tries', () => {
    const until = new Date(NOW + 10 * 60_000).toISOString();
    const { view, tile } = setup(() => ({
      ownerUserId: RIVAL,
      cooldownUntil: new Date(NOW + 4 * 3600_000).toISOString(),
    }));
    const broke = status({ attemptsLeft: 0, fenceBroken: [{ q: tile.q, r: tile.r, until }] });
    expect(territoryAction(tile, view, ME, broke, NOW)).toEqual({ kind: 'keep-going', until });
    // Too late: the tile rests as usual.
    expect(territoryAction(tile, view, ME, broke, Date.parse(until) + 1).kind).toBe('resting');
    // The owner fenced it up again meanwhile: no keep going.
    const refenced = { ...tile, fences: [0, 1, 2, 3, 4, 5].map((e) => segment(e)) };
    const refencedView = { ...view, tiles: view.tiles.map((t) => (t === tile ? refenced : t)) };
    expect(territoryAction(refenced, refencedView, ME, broke, NOW).kind).toBe('resting');
  });
});

describe('territoryAction', () => {
  it('offers Claim on wild land next to yours, with tries left', () => {
    const { view, tile } = setup();
    expect(territoryAction(tile, view, ME, status(), NOW)).toEqual({
      kind: 'claim',
      attemptsLeft: 7,
      // When tries refill, for the sheet's countdown (#201).
      triesResetAt: '2026-10-06T06:00:00.000Z',
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

  it('says land that isn’t next to yours is too far; a shielded Keeper’s says so even from afar', () => {
    const { view } = setup();
    const far = view.tiles.find((t) => t.q === 0 && t.r === 0)!;
    expect(territoryAction(far, view, ME, status(), NOW).kind).toBe('too-far');
    const theirs = { ...far, ownerUserId: userId(2) };
    const joined = Date.parse(view.members[1]!.joinedAt);
    expect(territoryAction(theirs, view, ME, status(), joined + 60_000).kind).toBe('shielded');
    expect(territoryAction(theirs, view, ME, status(), NOW + 365 * 24 * 60 * 60 * 1000).kind).toBe(
      'too-far',
    );
    // A home base says nothing extra, shield or not: it can never be taken.
    const theirHome = view.tiles.find((t) => t.ownerUserId === userId(2) && t.homeSlot !== null)!;
    expect(territoryAction(theirHome, view, ME, status(), joined + 60_000).kind).toBe('none');
  });

  it('offers nothing before it knows who you are and your tries', () => {
    const { view, tile } = setup();
    expect(territoryAction(tile, view, null, status(), NOW).kind).toBe('none');
    expect(territoryAction(tile, view, ME, null, NOW).kind).toBe('none');
  });
});

describe('watchInTheDark', () => {
  it('warns on my land no lit fire reaches, never on a home tile', () => {
    const { view, tile } = setup(() => ({ ownerUserId: ME }));
    expect(watchInTheDark(tile, view)).toBe(true);
    const home = view.tiles.find((t) => t.homeSlot !== null && t.ownerUserId === ME)!;
    expect(watchInTheDark(home, view)).toBe(false);
    const fire = {
      id: '0190a8c4-0000-7000-8000-000000000101',
      buildingId: 'hearthfire',
      kind: 'hearthfire' as const,
      level: 1,
      spot: 0,
      lit: true,
      safeRadius: 1,
    };
    const lit: MapView = {
      ...view,
      tiles: view.tiles.map((t) => (t === tile ? { ...t, buildings: [fire] } : t)),
    };
    expect(watchInTheDark(tile, lit)).toBe(false);
    // A fire out of fuel lights nothing.
    const out: MapView = {
      ...view,
      tiles: view.tiles.map((t) =>
        t === tile ? { ...t, buildings: [{ ...fire, lit: false }] } : t,
      ),
    };
    expect(watchInTheDark(tile, out)).toBe(true);
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

  it('says when tries and a resting tile come back, relatively (#201)', () => {
    const MIN = 60_000;
    expect(TERRITORY_TEXT.triesLeft(2, formatWait(200 * MIN))).toBe(
      '2 tries left · new tries in 3h 20m',
    );
    expect(TERRITORY_TEXT.triesLeft(1, formatWait(25 * MIN))).toBe('1 try left · new tries in 25m');
    expect(TERRITORY_TEXT.noTries(formatWait(200 * MIN))).toBe('New tries in 3h 20m 🌙');
    expect(TERRITORY_TEXT.resting(formatWait(65 * MIN))).toBe(
      'This land needs a rest. Try again in 1h 05m.',
    );
    expect(TERRITORY_TEXT.noTries(formatWait(30_000))).toBe('New tries in less than a minute 🌙');
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
