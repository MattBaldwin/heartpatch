import { findAvoidedWords, type MapView, type PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testClockworkIsle, testPatch, testWildIsle } from './test-view.js';
import {
  arrowArrays,
  hasWind,
  WIND_LOOK,
  WIND_TEXT,
  windOf,
  windPhase,
  windSpots,
} from './wind-layer.js';

const clockwork = testClockworkIsle();
const tile = (terrain: string, wind?: number): Pick<PublicTile, 'terrain' | 'wind'> => ({
  terrain,
  ...(wind === undefined ? {} : { wind }),
});

describe('wind layer (#874 C4)', () => {
  it("reads a tile's wind only from PublicTile.wind, and never on water", () => {
    expect(windOf(tile('meadow', 1))).toBe(1);
    expect(windOf(tile('hills', 3))).toBe(3);
    expect(windOf(tile('meadow'))).toBeNull();
    expect(windOf(tile('river', 2))).toBeNull();
    expect(windOf(tile('ocean', 2))).toBeNull();
    expect(windOf(tile('coast', 2))).toBe(2);
  });

  it('puts an arrow on every windy land tile of a Clockwork Isle, all three strengths', () => {
    const spots = windSpots(clockwork.tiles);
    const windy = clockwork.tiles.filter((t) => windOf(t) !== null);
    expect(spots).toHaveLength(windy.length);
    expect(new Set(spots.map((s) => s.strength))).toEqual(new Set([1, 2, 3]));
    expect(hasWind(clockwork)).toBe(true);
  });

  it('shows nothing on a Cozy Patch or a Wild Isle', () => {
    expect(hasWind(testPatch())).toBe(false);
    expect(hasWind(testWildIsle())).toBe(false);
    expect(windSpots(testWildIsle().tiles)).toEqual([]);
    // A Wild Isle tile that somehow carried wind still isn't a Clockwork Isle.
    const wild = testWildIsle();
    const odd: MapView = { ...wild, tiles: wild.tiles.map((t) => ({ ...t, wind: 2 })) };
    expect(hasWind(odd)).toBe(false);
  });

  it('gives every tile its own drift phase, the same every time', () => {
    expect(windPhase(3, -2)).toBe(windPhase(3, -2));
    expect(windPhase(3, -2)).not.toBe(windPhase(-2, 3));
    const phases = windSpots(clockwork.tiles).map((s) => s.phase);
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
    expect(new Set(phases.map((p) => Math.floor(p * 10))).size).toBeGreaterThan(5);
  });

  it('draws a stronger wind bolder, bigger and quicker (mockup M1)', () => {
    for (let i = 1; i < 3; i++) {
      expect(WIND_LOOK.arrow[i]?.[3]).toBeGreaterThan(WIND_LOOK.arrow[i - 1]?.[3] ?? 1);
      expect(WIND_LOOK.wash[i]?.[3]).toBeGreaterThan(WIND_LOOK.wash[i - 1]?.[3] ?? 1);
      expect(WIND_LOOK.scale[i]).toBeGreaterThan(WIND_LOOK.scale[i - 1] ?? 9);
      expect(WIND_LOOK.speed[i]).toBeGreaterThan(WIND_LOOK.speed[i - 1] ?? 9);
    }
  });

  it('builds two flat white arrows pointing along +x', () => {
    const a = arrowArrays();
    const xs = a.positions.filter((_, i) => i % 3 === 0);
    const ys = a.positions.filter((_, i) => i % 3 === 1);
    expect(new Set(ys)).toEqual(new Set([0]));
    expect(Math.max(...xs)).toBeGreaterThan(Math.abs(Math.min(...xs)) * 0.9);
    // Two shafts (2 triangles) and two heads (1 triangle each).
    expect(a.indices.length / 3).toBe(6);
    expect(new Set(a.colors)).toEqual(new Set([1]));
  });

  it('keeps its words kind and short', () => {
    const text = [WIND_TEXT.show, WIND_TEXT.hide, ...WIND_TEXT.strengths];
    expect(text.flatMap((t) => findAvoidedWords(t))).toEqual([]);
    expect(WIND_TEXT.strengths).toEqual(['Little breeze', 'Good breeze', 'Big brrr!']);
  });
});
