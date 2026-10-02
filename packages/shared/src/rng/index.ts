import { z } from 'zod';

/**
 * Seeded randomness for game logic (tech spec §8). Never use `Math.random()`:
 * every roll comes from an `Rng` built from a seed or a saved state, so the
 * same inputs always give the same outputs.
 *
 * The generator is sfc32 (Chris Doty-Humphrey's Small Fast Counter): 128 bits
 * of state, passes PractRand, and needs only 32-bit integer maths, which every
 * JS engine computes identically.
 */

const Uint32Schema = z.number().int().min(0).max(0xffff_ffff);

/** The generator's whole state: four unsigned 32-bit words. Plain JSON. */
export const RngStateSchema = z.tuple([Uint32Schema, Uint32Schema, Uint32Schema, Uint32Schema]);
export type RngState = readonly [number, number, number, number];

/**
 * A seed is an opaque string. The server makes one with `crypto.randomBytes`
 * and stores it with the battle or roll; shared code never creates seeds.
 */
export const SeedSchema = z.string().min(1).max(256);
export type Seed = z.infer<typeof SeedSchema>;

/** Rounds discarded after seeding so similar seeds quickly diverge. */
const WARM_UP_ROUNDS = 15;

/** cyrb128: hashes a string into four well-mixed 32-bit words. */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * A stable 128-bit hash of a string as 32 hex characters (cyrb128). For
 * fingerprints such as a battle's content hash; not cryptographic.
 */
export function hashString(text: string): string {
  return hashSeed(text)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/** A weighted choice: anything with a non-negative `weight`. */
/**
 * Derives a child seed from a parent seed and labels, e.g. a tile's spawn seed:
 * `deriveSeed(mapSeed, 'spawn', q, r, windowId)`. The same inputs always give
 * the same seed, so restarting a battle can't reroll what appears (tech spec
 * §8). Labels are joined unambiguously, so ('a', 'bc') and ('ab', 'c') differ.
 * The result is a fingerprint, not a secret-preserving hash: a derived seed
 * must stay on the server whenever its parent does.
 */
export function deriveSeed(parent: Seed, ...labels: readonly (string | number)[]): Seed {
  for (const label of labels) {
    if (typeof label === 'number' && !Number.isSafeInteger(label)) {
      throw new RangeError(`deriveSeed labels must be strings or safe integers, got ${label}`);
    }
  }
  return hashString(JSON.stringify([SeedSchema.parse(parent), ...labels]));
}

export interface Weighted {
  readonly weight: number;
}

/**
 * A seeded random number generator. It is mutable (each roll advances it), so
 * keep one private to a single computation and save `state()` when done.
 */
export class Rng {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  private constructor(state: RngState) {
    [this.#a, this.#b, this.#c, this.#d] = state;
  }

  /** A fresh generator for `seed`. The same seed always gives the same rolls. */
  static fromSeed(seed: Seed): Rng {
    const rng = new Rng(hashSeed(SeedSchema.parse(seed)));
    for (let i = 0; i < WARM_UP_ROUNDS; i++) rng.nextUint32();
    return rng;
  }

  /** Resumes from a saved `state()`. The input is copied, never changed. */
  static fromState(state: RngState): Rng {
    return new Rng(RngStateSchema.parse(state));
  }

  /** The current state, to store and resume from later. */
  state(): RngState {
    return [this.#a >>> 0, this.#b >>> 0, this.#c >>> 0, this.#d >>> 0];
  }

  /** A uniform unsigned 32-bit integer. */
  nextUint32(): number {
    const a = this.#a;
    const b = this.#b;
    const c = this.#c;
    const d = this.#d;
    const t = (((a + b) | 0) + d) | 0;
    this.#d = (d + 1) | 0;
    this.#a = b ^ (b >>> 9);
    this.#b = (c + (c << 3)) | 0;
    this.#c = (((c << 21) | (c >>> 11)) + t) | 0;
    return t >>> 0;
  }

  /** A uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** A uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`int(${min}, ${max}): expected integers with min <= max`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with `percent`% probability (0 never, 100 always; one roll either way). */
  chance(percent: number): boolean {
    return this.int(1, 100) <= percent;
  }

  /** A uniform pick from a non-empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() needs at least one item');
    // The index is in range, so this is an item (T itself may include undefined).
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * A pick weighted by each item's `weight`. Zero-weight items are never
   * chosen; at least one weight must be positive.
   */
  weighted<T extends Weighted>(items: readonly T[]): T {
    let total = 0;
    for (const item of items) {
      if (!(item.weight >= 0) || !Number.isFinite(item.weight)) {
        throw new RangeError(`weighted(): bad weight ${item.weight}`);
      }
      total += item.weight;
    }
    if (total <= 0) throw new RangeError('weighted() needs a positive total weight');
    let roll = this.next() * total;
    for (const item of items) {
      if (item.weight === 0) continue;
      roll -= item.weight;
      if (roll < 0) return item;
    }
    // Float rounding can leave a sliver past the end: fall back to the last
    // item that could have been picked (one exists, since total > 0).
    return items.findLast((item) => item.weight > 0) as T;
  }
}
