import { describe, expect, it } from 'vitest';
import { shortNumber } from './short-number.js';

describe('shortNumber', () => {
  it('leaves small counts as they are', () => {
    expect(shortNumber(0)).toBe('0');
    expect(shortNumber(42)).toBe('42');
    expect(shortNumber(999)).toBe('999');
  });

  it('shortens thousands to one decimal, dropping a .0', () => {
    expect(shortNumber(1_000)).toBe('1k');
    expect(shortNumber(1_250)).toBe('1.2k');
    expect(shortNumber(10_800)).toBe('10.8k');
    expect(shortNumber(240_000)).toBe('240k');
  });

  it('rounds down, so one short of full never reads full', () => {
    expect(shortNumber(10_799)).toBe('10.7k');
    expect(shortNumber(999_999)).toBe('999.9k');
  });

  it('shortens millions too', () => {
    expect(shortNumber(1_000_000)).toBe('1M');
    expect(shortNumber(2_560_000)).toBe('2.5M');
  });
});
