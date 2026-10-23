import type { CrookedSide } from '@heartpatch/shared';
import { merged, type Part } from '../../explore/kit-mesh.js';
import { ball, blk, flames, joyed, ring, tube, type V3 } from './crooked-kit.js';

// The bonus rooms' shapes (#306 6e), in the Crooked House's vinyl-toy kit:
// the treasure chest (its lid apart, so it can swing open) and the four
// sleeping doors' things (the design: a cold fireplace, a cracked window,
// cosy cartoon flames and a closet too dark to light). Room-local metres.

const CHEST = { wood: '#b8744a', band: '#f2b84b', lid: '#c98a5a', inside: '#5a3a5a' } as const; // TUNE

/** The chest's size: wide, deep, and the base's height (the lid's hinge is at its back top). */
export const CHEST_SIZE = { w: 1.0, d: 0.66, h: 0.5, lid: 0.26 } as const; // TUNE

/** The chest's box, standing at the origin, front towards −z (the camera). Always in colour. */
export function chestBase(): Part {
  const { w, d, h } = CHEST_SIZE;
  return merged([
    blk(w, h, d, [0, h / 2, 0], CHEST.wood, { round: 0.35, foot: '#8a5a3c' }),
    blk(w * 0.84, 0.04, d * 0.84, [0, h - 0.01, 0], CHEST.inside),
    blk(0.12, h * 1.02, d * 1.04, [-w * 0.3, h / 2, 0], CHEST.band, { round: 0.4 }),
    blk(0.12, h * 1.02, d * 1.04, [w * 0.3, h / 2, 0], CHEST.band, { round: 0.4 }),
    // The clasp, gold: the chest reads from across a dim room.
    blk(0.18, 0.18, 0.08, [0, h - 0.06, -d / 2 - 0.03], CHEST.band, { round: 0.6 }),
  ]);
}

/**
 * The lid, built about its hinge (the base's back top edge at the origin),
 * so turning it on x opens it: 0 shut, about −1.9 flung open.
 */
export function chestLid(): Part {
  const { w, d, lid } = CHEST_SIZE;
  return merged([
    blk(w * 1.02, lid, d * 1.02, [0, lid / 2, -d / 2], CHEST.lid, {
      round: 0.55,
      foot: CHEST.wood,
    }),
    blk(0.13, lid * 1.04, d * 1.06, [-w * 0.3, lid / 2, -d / 2], CHEST.band, { round: 0.5 }),
    blk(0.13, lid * 1.04, d * 1.06, [w * 0.3, lid / 2, -d / 2], CHEST.band, { round: 0.5 }),
  ]);
}

/** A sparkle mote for the bursts (a glowing material). */
export const mote = (): Part => merged([ball(0.24, [0, 0, 0], '#ffffff')]);

/** A leaf for Leaf's vine (a glowing material). */
export const leafMote = (): Part => merged([ball(0.3, [0, 0, 0], '#ffffff', [1, 0.35, 0.6])]);

/** Turns a door-local part (wall at z 0, the room towards −z) to face into the room from `side`. */
const FACING: Record<CrookedSide, number> = {
  n: 0,
  s: Math.PI,
  e: Math.PI / 2,
  w: -Math.PI / 2,
};

/**
 * A sleeping door's thing, on its main room's side of the wall: what the
 * power puts right (owner decision 7). `asleep` is before the power; after
 * it, what's left shows the door was opened by a friend. Door-local parts
 * turned to the wall; `null` for a power the kit doesn't know (data still draws).
 */
export function sleeperParts(
  power: string,
  asleep: boolean,
  at: V3,
  side: CrookedSide,
  joy: number,
): Part | null {
  const parts = SLEEPERS[power]?.(asleep, joy);
  if (!parts || parts.length === 0) return null;
  const one = merged(parts);
  one.position.set(...at);
  one.rotation.y = FACING[side];
  return one;
}

type SleeperBuilder = (asleep: boolean, joy: number) => Part[];

const stone = (joy: number) => joyed('#b9aaa0', joy);

const SLEEPERS: Readonly<Record<string, SleeperBuilder>> = {
  // Fire: the Parlour's cold fireplace. Lit, its back swung open into the Inglenook.
  fire: (asleep, j) => [
    blk(0.36, 1.5, 0.4, [-0.86, 0.75, -0.2], stone(j), { round: 0.4 }),
    blk(0.36, 1.5, 0.4, [0.86, 0.75, -0.2], stone(j), { round: 0.4 }),
    blk(2.2, 0.26, 0.5, [0, 1.6, -0.22], joyed('#8a5a3c', j), { round: 0.5 }),
    ...(asleep
      ? [
          // Grey ash logs, cold: nothing glows until a Fire friend helps.
          tube(0.9, 0.16, 0.16, [0, 0.12, -0.35], joyed('#6b5a52', 0), [0, 0, Math.PI / 2]),
          tube(0.8, 0.14, 0.14, [0.05, 0.27, -0.38], joyed('#6b5a52', 0), [0, 0.4, Math.PI / 2]),
        ]
      : [...flames([-0.95, 1.73, -0.22], 0.28), ...flames([0.95, 1.73, -0.22], 0.28)]),
  ],
  // Leaf: the Conservatory's cracked window. Opened, a vine grows through it into a bridge.
  leaf: (asleep, j) =>
    asleep
      ? [
          blk(1.2, 1.2, 0.08, [0, 1.1, -0.1], joyed('#fff1e8', j), { round: 0.3 }),
          blk(1.0, 1.0, 0.1, [0, 1.1, -0.11], '#bfe0ef'),
          // The crack: a zigzag of dark slivers across the glass.
          blk(0.5, 0.05, 0.12, [-0.2, 1.3, -0.12], '#4a5a6a', { rot: [0, 0, 0.7] }),
          blk(0.45, 0.05, 0.12, [0.12, 1.08, -0.12], '#4a5a6a', { rot: [0, 0, -0.6] }),
          blk(0.35, 0.05, 0.12, [0.05, 0.85, -0.12], '#4a5a6a', { rot: [0, 0, 0.8] }),
        ]
      : [
          tube(1.8, 0.14, 0.18, [0, 0.12, 0], joyed('#4f9d6b', j), [Math.PI / 2, 0, 0]),
          ...[-0.5, 0, 0.5].map((z) =>
            ball(0.3, [z * 0.6, 0.24, z], joyed('#7fd09b', j), [1, 0.4, 0.7]),
          ),
          ball(0.18, [0.3, 0.3, -0.6], joyed('#f7a1c4', j)),
        ],
  // Water: the Scullery's cosy cartoon flames (no heat). Put out, a puddle and a wisp of steam.
  water: (asleep, j) =>
    asleep
      ? [
          ...flames([0, 0, -0.35], 1.25),
          ...flames([-0.45, 0, -0.15], 0.8),
          ...flames([0.45, 0, -0.2], 0.9),
        ]
      : [
          tube(0.04, 1.3, 1.3, [0, 0.02, -0.45], joyed('#7bbcf2', j)),
          ball(0.26, [-0.2, 0.9, -0.4], joyed('#f1f4f8', j), [1, 0.7, 1]),
        ],
  // Light: a closet too dark even for the lantern. Opened, a little lantern hangs by the door.
  light: (asleep, j) =>
    asleep
      ? [
          blk(1.2, 1.95, 0.1, [0, 1.0, -0.1], '#1a1426', { round: 0.3 }),
          // Two tiny glints in the dark: something's in there.
          ball(0.08, [-0.14, 1.3, -0.17], '#5a4f78'),
          ball(0.08, [0.14, 1.3, -0.17], '#5a4f78'),
        ]
      : [
          ring(0.2, 0.04, [0.8, 1.9, -0.15], joyed('#3b2a22', j), [Math.PI / 2, 0, 0]),
          blk(0.2, 0.28, 0.2, [0.8, 1.65, -0.15], '#ffd27a', { round: 0.6 }),
        ],
};
