import { HEX_DIRECTIONS, hexKey, hexNeighbors, hexToWorld, type HexKey } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  FULL_MASK,
  armYaw,
  bridgeYaw,
  maskSides,
  neighbourMask,
  roadPieces,
} from './road-layout.js';

const origin = { q: 0, r: 0 };
const keys = (...dirs: number[]): Set<HexKey> =>
  new Set(dirs.map((i) => hexKey(hexNeighbors(origin)[i] ?? origin)));

describe('neighbourMask', () => {
  it('is 0 with nothing round it', () => {
    expect(neighbourMask(origin, new Set())).toBe(0);
  });

  it('sets bit i for the neighbour in HEX_DIRECTIONS[i]', () => {
    for (let i = 0; i < 6; i++) expect(neighbourMask(origin, keys(i))).toBe(1 << i);
  });

  it('is all six bits with all six neighbours, and ignores the tile itself', () => {
    const all = new Set(hexNeighbors(origin).map(hexKey));
    all.add(hexKey(origin));
    expect(neighbourMask(origin, all)).toBe(FULL_MASK);
  });

  it('covers every one of the 64 masks', () => {
    const seen = new Set<number>();
    for (let m = 0; m < 64; m++) {
      const sides = maskSides(m);
      seen.add(neighbourMask(origin, keys(...sides)));
    }
    expect(seen.size).toBe(64);
  });
});

describe('maskSides', () => {
  it('lists the set bits in order', () => {
    expect(maskSides(0b101001)).toEqual([0, 3, 5]);
    expect(maskSides(0)).toEqual([]);
  });
});

describe('roadPieces', () => {
  it('joins roads that touch and leaves a lone road a hub', () => {
    const [a, b] = hexNeighbors(origin);
    if (!a || !b) throw new Error('no neighbours');
    const far = { q: 9, r: 9 };
    const pieces = roadPieces([
      { ...origin, level: 1 },
      { ...a, level: 2 },
      { ...far, level: 3 },
    ]);
    expect(pieces[0]?.mask).toBe(1 << 0);
    expect(pieces[1]?.mask).toBe(1 << 3);
    expect(pieces[2]?.mask).toBe(0);
    expect(b).toBeDefined();
  });

  it('meets a bridge or dock end on', () => {
    const bridge = hexNeighbors(origin)[2];
    if (!bridge) throw new Error('no neighbour');
    const [piece] = roadPieces([{ ...origin, level: 1 }], [hexKey(bridge)]);
    expect(piece?.mask).toBe(1 << 2);
  });

  it('clamps a level to 1–3', () => {
    const levels = roadPieces([
      { q: 0, r: 0, level: 0 },
      { q: 5, r: 0, level: 7 },
    ]).map((p) => p.level);
    expect(levels).toEqual([1, 3]);
  });
});

describe('armYaw', () => {
  it('turns +x onto the side it names', () => {
    for (let i = 0; i < 6; i++) {
      const yaw = armYaw(i);
      const w = hexToWorld(HEX_DIRECTIONS[i] ?? origin, 1);
      const len = Math.hypot(w.x, w.z);
      expect(Math.cos(yaw)).toBeCloseTo(w.x / len, 6);
      expect(-Math.sin(yaw)).toBeCloseTo(w.z / len, 6);
    }
  });

  it('rejects a side that is not there', () => {
    expect(() => armYaw(6)).toThrow(RangeError);
  });
});

describe('bridgeYaw', () => {
  it('runs between two banks that face each other', () => {
    expect(bridgeYaw(origin, keys(1, 4))).toBeCloseTo(armYaw(1), 6);
  });

  it('prefers an opposite pair over a lone side', () => {
    expect(bridgeYaw(origin, keys(0, 2, 5))).toBeCloseTo(armYaw(2), 6);
  });

  it('follows one bank and keeps the default with none', () => {
    expect(bridgeYaw(origin, keys(4))).toBeCloseTo(armYaw(4), 6);
    expect(bridgeYaw(origin, new Set())).toBe(0);
  });
});
