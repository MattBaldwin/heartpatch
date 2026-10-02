import { describe, expect, it } from 'vitest';
import { ElementIdSchema, FeelingIdSchema } from '../schemas/data/elements.js';
import { ELEMENT_MATRIX, FEELING_MATRIX, SYNERGY_TABLE } from './matrices.js';

const elements = ElementIdSchema.options;
const feelings = FeelingIdSchema.options;

/** Sum of a row (attacking) and a column (defending) of a square matrix. */
function rowAndColumnSums<K extends string>(
  matrix: Record<K, Record<K, number>>,
  keys: readonly K[],
) {
  return keys.map((k) => ({
    id: k,
    row: keys.reduce((sum, other) => sum + matrix[k][other], 0),
    column: keys.reduce((sum, other) => sum + matrix[other][k], 0),
  }));
}

/** Pairs (a, b) where a's attacking row is at least b's everywhere and better somewhere. */
function dominatedRows<K extends string>(matrix: Record<K, Record<K, number>>, keys: readonly K[]) {
  const pairs: string[] = [];
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const atLeast = keys.every((d) => matrix[a][d] >= matrix[b][d]);
      const better = keys.some((d) => matrix[a][d] > matrix[b][d]);
      if (atLeast && better) pairs.push(`${a} beats ${b} everywhere`);
    }
  }
  return pairs;
}

describe('element matrix', () => {
  it('follows the standard wheel (design doc §5)', () => {
    expect(ELEMENT_MATRIX.fire.leaf).toBeGreaterThan(1);
    expect(ELEMENT_MATRIX.leaf.water).toBeGreaterThan(1);
    expect(ELEMENT_MATRIX.water.fire).toBeGreaterThan(1);
    expect(ELEMENT_MATRIX.leaf.fire).toBeLessThan(1);
  });

  it('is neutral for a matchup with itself', () => {
    for (const e of elements) expect(ELEMENT_MATRIX[e][e]).toBe(1);
  });

  it('gives every element strengths and weaknesses, and no strictly-best element', () => {
    for (const e of elements) {
      const row = Object.values(ELEMENT_MATRIX[e]);
      expect(
        row.some((v) => v > 1),
        `${e} has no advantage`,
      ).toBe(true);
      expect(
        elements.some((a) => ELEMENT_MATRIX[a][e] > 1),
        `${e} has no weakness`,
      ).toBe(true);
    }
    expect(dominatedRows(ELEMENT_MATRIX, elements)).toEqual([]);
    // What an element dishes out on average, it also takes.
    for (const { id, row, column } of rowAndColumnSums(ELEMENT_MATRIX, elements)) {
      expect(row, id).toBeCloseTo(column);
    }
  });
});

describe('feeling matrix', () => {
  it('has the counters from the design doc', () => {
    expect(FEELING_MATRIX.silly.brave).toBeGreaterThan(1); // Silly disarms Brave
    expect(FEELING_MATRIX.brave.sleepy).toBeGreaterThan(1); // Brave overwhelms Sleepy
  });

  it('can blunt an element disadvantage', () => {
    const best = Math.max(...feelings.flatMap((a) => feelings.map((d) => FEELING_MATRIX[a][d])));
    expect(0.5 * best).toBeGreaterThan(0.5);
  });

  it('gives every feeling counters both ways, and no strictly-best feeling', () => {
    for (const f of feelings) {
      expect(
        Object.values(FEELING_MATRIX[f]).some((v) => v > 1),
        `${f} counters nothing`,
      ).toBe(true);
      expect(
        feelings.some((a) => FEELING_MATRIX[a][f] > 1),
        `${f} has no counter`,
      ).toBe(true);
    }
    expect(dominatedRows(FEELING_MATRIX, feelings)).toEqual([]);
    for (const { id, row, column } of rowAndColumnSums(FEELING_MATRIX, feelings)) {
      expect(row, id).toBeCloseTo(column);
    }
  });
});

describe('synergy table', () => {
  it('has the harmonious and conflicted combos from the design doc', () => {
    expect(SYNERGY_TABLE.shadow.spooky).toBeGreaterThan(1);
    expect(SYNERGY_TABLE.fire.cozy).toBeGreaterThan(1);
    expect(SYNERGY_TABLE.shadow.joy).toBeLessThan(1);
  });

  it('gives every element and feeling a harmonious and a conflicted combo', () => {
    for (const e of elements) {
      const row = Object.values(SYNERGY_TABLE[e]);
      expect(row.some((v) => v > 1) && row.some((v) => v < 1), e).toBe(true);
    }
    for (const f of feelings) {
      const column = elements.map((e) => SYNERGY_TABLE[e][f]);
      expect(column.some((v) => v > 1) && column.some((v) => v < 1), f).toBe(true);
    }
  });

  it('gives every element the same total, so no element is strictly best', () => {
    const totals = elements.map((e) => Object.values(SYNERGY_TABLE[e]).reduce((a, b) => a + b, 0));
    for (const total of totals) expect(total).toBeCloseTo(totals[0]!);
  });
});
