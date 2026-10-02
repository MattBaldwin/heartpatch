import { deriveSeed, hashString, Rng } from '@heartpatch/shared';
import { FIXED_COLORS } from '../config.js';
import { hexToRgb, type Rgb } from '../params.js';
import { SPROUT } from './sprout-config.js';

/**
 * Everything that makes one player's Sprout look like itself. Pure and seeded
 * like squishies (DECISIONS "Procedural squishies (#9)"): only `+ − × ÷` and
 * the seeded `Rng`, so every engine draws the same Sprout. Degrees stay
 * degrees here; the actor converts them when it builds meshes.
 */
export interface SproutParams {
  readonly body: Rgb;
  readonly leaf: Rgb;
  readonly ink: Rgb;
  readonly blush: Rgb;
  /** Emissive strength, 0–1 of the body colour. */
  readonly glow: number;
  /** Height over width. */
  readonly squash: number;
  readonly leafSplayDeg: number;
}

const between = (rng: Rng, min: number, max: number) => min + (max - min) * rng.next();

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Sprout for `ownerId` (the player whose Heart Seed it is). */
export function sproutParams(ownerId: string): SproutParams {
  const rng = Rng.fromSeed(deriveSeed('sprout', ownerId));
  const [warm, deep] = SPROUT.bodyColors;
  return {
    body: mix(hexToRgb(warm), hexToRgb(deep), rng.next()),
    leaf: hexToRgb(SPROUT.leafColor),
    ink: hexToRgb(FIXED_COLORS.ink),
    blush: hexToRgb(FIXED_COLORS.blush),
    glow: between(rng, SPROUT.glow.min, SPROUT.glow.max),
    squash: between(rng, SPROUT.squash.min, SPROUT.squash.max),
    leafSplayDeg: between(rng, SPROUT.leafSplayDeg.min, SPROUT.leafSplayDeg.max),
  };
}

/** A stable fingerprint (tests and the dev hook compare these, not pixels). */
export function sproutHash(params: SproutParams): string {
  return hashString(JSON.stringify(params));
}
