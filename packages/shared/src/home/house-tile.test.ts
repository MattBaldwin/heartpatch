import { describe, expect, it } from 'vitest';
import { hex, hexAdd, hexKey, hexNeighbors } from '../hex/index.js';
import { HOUSE_TILE_ORDER, houseTile } from './house-tile.js';

const SEED = hex(4, -2);
const HOME = [SEED, ...hexNeighbors(SEED)];
const at = (i: number) => hexAdd(SEED, HOUSE_TILE_ORDER[i]!);

describe('houseTile (#604)', () => {
  it('tries all six ring tiles, each once', () => {
    expect(new Set(HOUSE_TILE_ORDER.map((h) => hexKey(h))).size).toBe(6);
    expect(new Set(HOUSE_TILE_ORDER.map((h) => hexKey(hexAdd(SEED, h))))).toEqual(
      new Set(hexNeighbors(SEED).map((h) => hexKey(h))),
    );
  });

  it('puts a new home’s house on the back-right ring tile', () => {
    expect(houseTile(HOME, [])).toEqual(hex(5, -3));
  });

  it('gives an older home the first ring tile with no building', () => {
    expect(houseTile(HOME, [at(0)])).toEqual(at(1));
    expect(houseTile(HOME, [at(0), at(1), at(2)])).toEqual(at(3));
  });

  it('ignores buildings on the Heart Seed tile and off home', () => {
    expect(houseTile(HOME, [SEED, hex(20, 20)])).toEqual(at(0));
  });

  it('reads the same whatever order the tiles and buildings come in', () => {
    const shuffled = [...HOME].reverse();
    expect(houseTile(shuffled, [at(1), at(0)])).toEqual(houseTile(HOME, [at(0), at(1)]));
  });

  it('is null with every ring tile built on, or no middle (the house stays by the Heart Seed)', () => {
    expect(
      houseTile(
        HOME,
        HOUSE_TILE_ORDER.map((_, i) => at(i)),
      ),
    ).toBeNull();
    expect(houseTile([SEED, at(0)], [])).toBeNull();
    expect(houseTile([], [])).toBeNull();
  });

  it('skips a ring tile the home doesn’t have', () => {
    const missing = HOME.filter((t) => hexKey(t) !== hexKey(at(0)));
    // Six tiles round a missing one: their middle isn't a whole hex, so no seed.
    expect(houseTile(missing, [])).toBeNull();
  });
});
