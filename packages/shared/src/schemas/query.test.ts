import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { queryArray, queryBool, queryInt } from './query.js';

describe('queryInt', () => {
  const schema = queryInt({ min: 1, max: 100 });

  it('parses whole numbers', () => {
    expect(schema.parse('42')).toBe(42);
  });

  it('rejects empty, decimal, junk and out-of-range values', () => {
    for (const bad of ['', '1.5', 'abc', '0', '101', ' 5']) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('queryBool', () => {
  it('parses true/false and 1/0', () => {
    expect(queryBool().parse('true')).toBe(true);
    expect(queryBool().parse('1')).toBe(true);
    expect(queryBool().parse('false')).toBe(false);
    expect(queryBool().parse('0')).toBe(false);
  });

  it('rejects anything else', () => {
    expect(queryBool().safeParse('yes').success).toBe(false);
    expect(queryBool().safeParse('').success).toBe(false);
  });
});

describe('queryArray', () => {
  const schema = queryArray(z.enum(['a', 'b']));

  it('wraps a single value', () => {
    expect(schema.parse('a')).toEqual(['a']);
  });

  it('keeps repeated values', () => {
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('validates each item', () => {
    expect(schema.safeParse(['a', 'c']).success).toBe(false);
  });
});
