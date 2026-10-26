import { describe, expect, it } from 'vitest';
import { bankField, bankShape } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';

const BANK = WEATHER_LOOK.clouds.bank;

describe("a storm's bank", () => {
  const shape = bankShape();
  const ys: number[] = [];
  const xs: number[] = [];
  for (let i = 0; i < shape.positions.length; i += 3) {
    xs.push(shape.positions[i] ?? 0);
    ys.push(shape.positions[i + 1] ?? 0);
  }

  it('is one wide slab, many times wider than tall', () => {
    const wide = Math.max(...xs) - Math.min(...xs);
    const tall = Math.max(...ys) - Math.min(...ys);
    expect(wide).toBeGreaterThan(BANK.wide * 1.8);
    expect(wide / tall).toBeGreaterThan(4);
  });

  it('has a hard flat belly: nothing below it, a big share of the surface on it, facing down', () => {
    expect(Math.min(...ys)).toBe(0);
    const flat = ys.filter((y) => y === 0).length;
    expect(flat / ys.length).toBeGreaterThan(0.3);
    const i = ys.indexOf(0);
    expect(shape.normals[i * 3 + 1]).toBe(-1);
  });

  it('shows its puffs as bumps along the top', () => {
    // Across the middle, west to east, the top rises and falls more than once.
    let turns = 0;
    let last = 0;
    let prev = Number.NaN;
    for (let x = -BANK.wide * 0.8; x <= BANK.wide * 0.8; x += 0.05) {
      let y = BANK.thick * 3;
      while (y > 0 && bankField(x, y, 0) > 0) y -= 0.01;
      if (!Number.isNaN(prev)) {
        const dir = Math.sign(y - prev);
        if (dir !== 0 && dir !== last) {
          if (last !== 0) turns++;
          last = dir;
        }
      }
      prev = y;
    }
    expect(turns).toBeGreaterThan(4);
  });

  it('is wound and sized for one draw', () => {
    expect(shape.indices.length % 3).toBe(0);
    expect(xs.length).toBeLessThan(6000);
  });
});
