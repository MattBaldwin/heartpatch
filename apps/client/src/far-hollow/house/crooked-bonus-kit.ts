import type { CrookedSide } from '@heartpatch/shared';
import { ELEMENT_FX } from '../../battle/element-fx.js';
import { merged, type Part } from '../../explore/kit-mesh.js';
import { ball, blk, flames, joyed, ring, tube, type V3 } from './crooked-kit.js';

// The bonus rooms' shapes (#306 6e), in the Crooked House's vinyl-toy kit:
// the treasure chest (its lid apart, so it can swing open) and the four
// sleeping doors' things (the design: a cold fireplace, a cracked window,
// cosy cartoon flames and a closet too dark to light). Room-local metres.

const CHEST = {
  wood: '#b8744a',
  band: '#f2b84b',
  lid: '#c98a5a',
  inside: '#e9b54a',
  coin: '#ffd27a',
  hinge: '#6b4a2a',
} as const; // TUNE

/** The chest's size: wide, deep, and the base's height (the lid's hinge is at its back top). */
export const CHEST_SIZE = { w: 1.0, d: 0.66, h: 0.5, lid: 0.26 } as const; // TUNE

/** The chest's box, standing at the origin, front towards −z (the camera). Always in colour. */
export function chestBase(): Part {
  const { w, d, h } = CHEST_SIZE;
  return merged([
    blk(w, h, d, [0, h / 2, 0], CHEST.wood, { round: 0.35, foot: '#8a5a3c' }),
    // Full to the brim: gold inside, a heap of coins that shines once the lid swings back.
    blk(w * 0.84, 0.04, d * 0.84, [0, h - 0.01, 0], CHEST.inside),
    ...[
      [-0.22, -0.08],
      [0.05, 0.06],
      [0.24, -0.05],
      [-0.05, -0.12],
      [0.12, 0.1],
    ].map(([x, z]) => ball(0.2, [x ?? 0, h + 0.02, z ?? 0], CHEST.coin, [1, 0.45, 1])),
    // The hinges at the back, so the lid reads as one that swings.
    tube(0.16, 0.07, 0.07, [-w * 0.3, h, d / 2], CHEST.hinge, [0, 0, Math.PI / 2]),
    tube(0.16, 0.07, 0.07, [w * 0.3, h, d / 2], CHEST.hinge, [0, 0, Math.PI / 2]),
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

/** A glowing pad under a friend while it helps (a glowing material), 1 m across. */
export const halo = (): Part => merged([tube(0.03, 1, 1, [0, 0.02, 0], '#ffffff')]);

/**
 * What glows once a friend has woken a door, door-local like the sleepers
 * (a glowing material, one colour a power): the fire in the hearth, the
 * blossoms on the vine, the puddle's shine, the closet's little lantern.
 */
export function wokenGlow(power: string): Part | null {
  const parts = WOKEN[power]?.();
  return parts && parts.length > 0 ? merged(parts) : null;
}

const WOKEN: Readonly<Record<string, () => Part[]>> = {
  fire: () => [...flames([0, 0.08, -0.5], 1.35), ...flames([0.32, 0.08, -0.62], 0.7)],
  leaf: () => [
    ball(0.2, [-0.3, 0.32, -0.3], '#ffffff'),
    ball(0.16, [0.3, 0.3, -0.6], '#ffffff'),
    ball(0.18, [0, 0.34, 0.3], '#ffffff'),
  ],
  water: () => [tube(0.02, 0.9, 0.9, [0, 0.05, -0.45], '#ffffff')],
  light: () => [ball(0.3, [0.8, 1.62, -0.15], '#ffffff')],
};

/** How far each element colour is lightened towards white, so it reads as light. */
const LIGHTEN = 0.35; // TUNE

/** `hex` mixed `by` of the way to white. */
function lightened(hex: string, by: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * by);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Each power's glow colour once woken: the element's own (the battle's palette), lightened. */
export const WOKEN_COLOUR: Readonly<Record<string, string>> = Object.fromEntries(
  ['fire', 'leaf', 'water', 'light'].map((power) => [
    power,
    lightened(ELEMENT_FX[power]?.colors[0] ?? '#ffffff', LIGHTEN),
  ]),
);

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

/** The turn that faces a door-local part into the room from its wall. */
export const doorFacing = (side: CrookedSide): number => FACING[side];

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
    // The hearth on the floor in front: what the camera above sees best.
    blk(2.0, 0.08, 1.0, [0, 0.04, -0.55], joyed('#8f8178', j), { round: 0.3 }),
    // The logs: grey ash while cold; brown, with the fire's glow on them, once lit.
    tube(1.0, 0.2, 0.2, [0, 0.18, -0.5], asleep ? '#5e5450' : '#7a4a2a', [0, 0.25, Math.PI / 2]),
    tube(0.9, 0.18, 0.18, [0.05, 0.18, -0.62], asleep ? '#6b605a' : '#8a5a3c', [
      0,
      -0.3,
      Math.PI / 2,
    ]),
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
