import { findAvoidedWords, HOLLOW_RULES, HOME_BASE_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HOLLOWED_EXPLORE } from './hollowed-config.js';
import {
  discOpening,
  echoAt,
  HOLLOWED_TEXT,
  pieceOf,
  PUZZLE_INDEX,
  puzzleLines,
  puzzleSpot,
  skinOf,
  sparkAt,
  spookPush,
  spookReach,
  villageShut,
} from './hollowed-explore-view.js';

const { echo } = HOLLOWED_EXPLORE;

describe('exploring a grey village tile (#306 2a): words', () => {
  it('names the village and today’s joy in the header', () => {
    expect(HOLLOWED_TEXT.title('Bramble Hollow')).toBe('Bramble Hollow 🕯️');
    expect(HOLLOWED_TEXT.joy(25)).toBe('Joy 25% ✨');
  });

  it('keeps the words kind and short (style guide §2, §8, §9)', () => {
    for (const line of [HOLLOWED_TEXT.spooked, HOLLOWED_TEXT.closed, HOLLOWED_TEXT.title('x')]) {
      expect(findAvoidedWords(line)).toEqual([]);
      expect(line.split(' ').length).toBeLessThanOrEqual(10);
    }
  });

  it('shuts at nightfall and opens in the morning, map time', () => {
    expect(villageShut(12 * 60)).toBe(false);
    expect(villageShut(HOME_BASE_RULES.nightfallMinute)).toBe(true);
    expect(villageShut(HOLLOW_RULES.morningMinute - 1)).toBe(true);
    expect(villageShut(HOLLOW_RULES.morningMinute)).toBe(false);
  });
});

describe('a Hollow echo', () => {
  it('drifts on a slow loop round its point and comes back each lap', () => {
    const centre = { x: 0.2, z: -0.1 };
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    echoAt(centre, 0, a);
    echoAt(centre, echo.lapSeconds, b);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.z).toBeCloseTo(b.z);
    for (let t = 0; t < echo.lapSeconds; t += 0.7) {
      echoAt(centre, t, a);
      expect(Math.hypot(a.x - centre.x, a.z - centre.z)).toBeLessThanOrEqual(echo.orbit + 1e-9);
    }
  });

  it('reaches half as far with a lantern in hand', () => {
    expect(spookReach(false)).toBe(echo.reach);
    expect(spookReach(true)).toBeCloseTo(echo.reach * echo.lantern);
  });

  it('nudges the Keeper straight back, past its reach, and leaves it alone outside', () => {
    const at = { x: 0, z: 0 };
    expect(spookPush({ x: 0, z: -echo.reach - 0.01 }, at, echo.reach)).toBeNull();
    const pushed = spookPush({ x: 0, z: -echo.reach / 2 }, at, echo.reach)!;
    expect(pushed.x).toBeCloseTo(0);
    expect(pushed.z).toBeLessThan(-echo.reach);
    expect(Math.hypot(pushed.x, pushed.z)).toBeCloseTo(echo.reach + echo.push);
    // Right on top of it: back towards the camera.
    expect(spookPush({ x: 0, z: 0 }, at, echo.reach)!.z).toBeLessThan(0);
  });
});

describe('joy discs and sparks', () => {
  it('open over growMs, eased; one searched before the visit is already open', () => {
    expect(discOpening(null, 123)).toBe(1);
    expect(discOpening(1000, 1000)).toBe(0);
    expect(discOpening(1000, 1000 + HOLLOWED_EXPLORE.joy.growMs / 2)).toBeCloseTo(0.75);
    expect(discOpening(1000, 1000 + HOLLOWED_EXPLORE.joy.growMs * 2)).toBe(1);
  });

  it('rise and fan out from the spot, then shrink away', () => {
    const out = { dx: 0, dy: 0, dz: 0, s: 0, a: 0 };
    for (let i = 0; i < HOLLOWED_EXPLORE.sparks.count; i++) {
      sparkAt(i, 0.5, out);
      expect(out.dy).toBeGreaterThan(0);
      expect(out.s).toBeGreaterThan(0);
      expect(Math.hypot(out.dx, out.dz)).toBeLessThanOrEqual(HOLLOWED_EXPLORE.sparks.spread);
      sparkAt(i, 1, out);
      expect(out.s).toBeCloseTo(0);
    }
  });
});

describe('a grey village tile’s memory puzzle (#306 PR 2b): words', () => {
  const puzzle = {
    skin: 'mural',
    order: ['sun', 'tree', 'house', 'rainbow'],
    x: 0.2,
    z: -0.1,
    solved: false,
  };

  it('names the broken thing on the button and the card', () => {
    const skin = skinOf(puzzle);
    expect(HOLLOWED_TEXT.fix(skin)).toBe('Fix the mural');
    expect(HOLLOWED_TEXT.broken(skin)).toBe('A broken mural 🖼️');
    expect(HOLLOWED_TEXT.placed(2, 4)).toBe('2 of 4 back');
    expect(pieceOf(skin, 'sun')).toEqual({ emoji: '🌞', name: 'the sun' });
    // A skin this build doesn't know yet still draws (the default's words).
    expect(skinOf({ skin: 'tea-set' }).id).toBe('music-box');
  });

  it('is one more spot to walk up to, done once mended', () => {
    expect(puzzleSpot(undefined)).toBeNull();
    expect(puzzleSpot(puzzle)).toEqual({
      index: PUZZLE_INDEX,
      kind: 'puzzle',
      tool: null,
      x: 0.2,
      z: -0.1,
      done: false,
    });
    expect(puzzleSpot({ ...puzzle, solved: true })?.done).toBe(true);
  });

  it('says what mending it gave, and never nothing', () => {
    const base = { puzzle: { ...puzzle, solved: true }, recipe: null, found: {}, items: {} };
    expect(
      puzzleLines({ ...base, lore: { id: 'the-painted-wall', title: 'The Painted Wall' } }),
    ).toEqual([{ text: '📜 A lore page! “The Painted Wall”', note: 'Added to your Lorebook 📖' }]);
    expect(
      puzzleLines({ ...base, lore: null, recipe: { id: 'heart-tea', title: 'Heart Tea' } }),
    ).toEqual([{ text: '📖 A new recipe! “Heart Tea”' }]);
    expect(puzzleLines({ ...base, lore: null, found: { heartdust: 1 } })[0]?.text).toMatch(/×1$/);
    expect(puzzleLines({ ...base, lore: null })).toEqual([{ text: 'The Hollow says thank you!' }]);
  });

  it('keeps every puzzle line kind (style guide §9)', () => {
    for (const line of Object.values(HOLLOWED_TEXT)) {
      if (typeof line === 'string') expect(findAvoidedWords(line)).toEqual([]);
    }
  });
});
