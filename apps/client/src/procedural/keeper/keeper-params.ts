import {
  deriveSeed,
  hashString,
  Rng,
  WARDROBE_SLOTS,
  type KeeperBase,
  type KeeperConfig,
  type KeeperData,
  type Hairstyle,
  type PartShape,
  type WardrobeSlot,
} from '@heartpatch/shared';
import { hexToRgb, type Rgb, type Vec3 } from '../params.js';
import { KEEPER } from './keeper-config.js';
import type { KeeperItem } from './keeper-items.js';

/**
 * Turns a Keeper config (design doc §23) into the pieces that draw it and the
 * sockets clothing attaches to. Pure and seeded like squishies (DECISIONS
 * "Procedural squishies (#9)"): only `+ − × ÷`, `Math.sqrt` (correctly
 * rounded everywhere) and the seeded `Rng`, so the same config is the same
 * Keeper for every player on every engine. Rotations stay in degrees; the
 * field turns them into matrices when it builds meshes.
 *
 * Keeper space: the feet stand on y = 0, the face looks along −z (towards a
 * camera with the default heading), +x is the viewer's right. Sizes are
 * world units for a Keeper at scale 1.
 */

/** What a piece is part of (tests and the gallery count these). */
export type KeeperLayer = 'body' | 'face' | 'hair' | 'outfit' | WardrobeSlot;

export interface KeeperPiece {
  readonly shape: PartShape;
  /** Centre in Keeper space. */
  readonly at: Vec3;
  /** Size of the unit-box primitive. */
  readonly size: Vec3;
  /** Degrees: pitch (x), yaw (y), roll (z). */
  readonly turn: Vec3;
  readonly color: Rgb;
  readonly layer: KeeperLayer;
}

/**
 * Where a wardrobe slot's items go: one anchor, or two mirrored ones (shoes,
 * left then right), and the size of the body part the socket sits on, which
 * scales the item so it fits this base.
 */
export interface KeeperSocket {
  readonly slot: WardrobeSlot;
  readonly anchors: readonly Vec3[];
  readonly size: Vec3;
}

export interface KeeperParams {
  readonly config: KeeperConfig;
  /** World height of the Keeper (top of the hair) at scale 1. */
  readonly height: number;
  /** Widest point across, for the contact shadow. */
  readonly width: number;
  readonly pieces: readonly KeeperPiece[];
  readonly sockets: Readonly<Record<WardrobeSlot, KeeperSocket>>;
  /** Ids of the items worn, in slot order (a costume hides the other items and the hair). */
  readonly worn: readonly string[];
  /** Config ids this client doesn't know (an outdated client); drawn with the base's own. */
  readonly missing: readonly string[];
}

const NO_TURN: Vec3 = [0, 0, 0];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/** A value in `[-spread, spread]`. */
const wobble = (rng: Rng, spread: number) => (rng.next() * 2 - 1) * spread;

/** The head: a centre and its three radii. */
interface Head {
  readonly c: Vec3;
  readonly r: Vec3;
}

/** A point in head units: radii from the head's centre. */
const onHead = (head: Head, x: number, y: number, z: number): Vec3 => [
  head.c[0] + x * head.r[0],
  head.c[1] + y * head.r[1],
  head.c[2] + z * head.r[2],
];

/** A size in head diameters. */
const headSized = (head: Head, x: number, y: number, z: number): Vec3 => [
  x * 2 * head.r[0],
  y * 2 * head.r[1],
  z * 2 * head.r[2],
];

/** How far hair reaches above and around the head (head radii), per style, for the hat socket. */
const HAIR_VOLUME: Readonly<Record<Hairstyle, { top: number; width: number }>> = {
  bob: { top: 1.2, width: 1.12 },
  spiky: { top: 1.45, width: 1.1 },
  pigtails: { top: 1.2, width: 1.08 },
  bun: { top: 1.2, width: 1.08 },
  curly: { top: 1.38, width: 1.25 },
  long: { top: 1.2, width: 1.1 },
  swoop: { top: 1.28, width: 1.1 },
  puff: { top: 1.62, width: 1.34 },
};

/**
 * Hair pieces per style, in head units: `[x, y, z]` centre, `[x, y, z]` size
 * in head diameters, turn in degrees. The cap (top and back of the head)
 * sits up and back, so the face stays clear under the fringe.
 */
type HairSpec = readonly [shape: PartShape, at: Vec3, size: Vec3, turn?: Vec3];

const CAP: HairSpec = ['ellipsoid', [0, 0.28, 0.16], [1.08, 0.92, 1.08]];
const FRINGE: HairSpec = ['ellipsoid', [0, 0.5, -0.5], [1.12, 0.5, 0.6], [-25, 0, 0]];

const HAIRSTYLES: Readonly<Record<Hairstyle, readonly HairSpec[]>> = {
  bob: [
    CAP,
    FRINGE,
    ['ellipsoid', [-0.86, -0.12, 0.12], [0.42, 1.1, 0.9]],
    ['ellipsoid', [0.86, -0.12, 0.12], [0.42, 1.1, 0.9]],
    ['ellipsoid', [0, -0.15, 0.42], [1.55, 1.05, 0.9]],
  ],
  spiky: [
    ['ellipsoid', [0, 0.3, 0.14], [1.06, 0.9, 1.06]],
    ['cone', [0, 1.12, 0.05], [0.42, 0.62, 0.42]],
    ['cone', [-0.5, 0.98, 0], [0.4, 0.56, 0.4], [0, 0, 28]],
    ['cone', [0.5, 0.98, 0], [0.4, 0.56, 0.4], [0, 0, -28]],
    ['cone', [0, 0.92, -0.5], [0.4, 0.5, 0.4], [-32, 0, 0]],
    ['cone', [-0.4, 0.86, 0.52], [0.38, 0.5, 0.38], [30, 0, 20]],
    ['cone', [0.4, 0.86, 0.52], [0.38, 0.5, 0.38], [30, 0, -20]],
  ],
  pigtails: [
    CAP,
    FRINGE,
    ['teardrop', [-1.12, -0.12, 0.22], [0.5, 0.95, 0.5], [0, 0, -150]],
    ['teardrop', [1.12, -0.12, 0.22], [0.5, 0.95, 0.5], [0, 0, 150]],
  ],
  bun: [CAP, FRINGE, ['ellipsoid', [0, 1.15, 0.32], [0.72, 0.66, 0.72]]],
  curly: [
    ['ellipsoid', [0, 0.3, 0.18], [1.14, 0.96, 1.12]],
    FRINGE,
    ['ellipsoid', [0, 1.08, 0.12], [0.55, 0.5, 0.55]],
    ['ellipsoid', [-0.6, 0.92, 0.1], [0.52, 0.5, 0.52]],
    ['ellipsoid', [0.6, 0.92, 0.1], [0.52, 0.5, 0.52]],
    ['ellipsoid', [-0.95, 0.35, 0.25], [0.5, 0.5, 0.5]],
    ['ellipsoid', [0.95, 0.35, 0.25], [0.5, 0.5, 0.5]],
    ['ellipsoid', [-0.82, -0.25, 0.35], [0.46, 0.46, 0.46]],
    ['ellipsoid', [0.82, -0.25, 0.35], [0.46, 0.46, 0.46]],
    ['ellipsoid', [0, 0.55, 0.85], [0.6, 0.55, 0.5]],
    ['ellipsoid', [-0.5, -0.1, 0.85], [0.52, 0.52, 0.48]],
    ['ellipsoid', [0.5, -0.1, 0.85], [0.52, 0.52, 0.48]],
  ],
  long: [
    CAP,
    FRINGE,
    ['capsule', [0, -0.55, 0.5], [1.45, 1.5, 0.55]],
    ['capsule', [-0.88, -0.5, 0.05], [0.34, 1.2, 0.4]],
    ['capsule', [0.88, -0.5, 0.05], [0.34, 1.2, 0.4]],
  ],
  swoop: [CAP, FRINGE, ['teardrop', [-0.3, 0.74, -0.3], [0.75, 1.25, 0.6], [-20, 0, 72]]],
  puff: [['ellipsoid', [0, 0.48, 0.24], [1.34, 1.14, 1.24]]],
};

/** A point on the head's front surface (`fx`, `fy` from its middle, in head diameters). */
function facePoint(head: Head, fx: number, fy: number, depth: number): { at: Vec3; turn: Vec3 } {
  const [rx, ry, rz] = head.r;
  const x = fx * 2 * rx;
  const y = fy * 2 * ry;
  const inside = 1 - (x / rx) * (x / rx) - (y / ry) * (y / ry);
  const surface = head.c[2] - rz * Math.sqrt(inside > 0 ? inside : 0);
  // Stands a little out of the surface; the rest sinks in.
  const z = surface - depth * KEEPER.face.standOut + depth / 2;
  return {
    at: [head.c[0] + x, head.c[1] + y, z],
    // Half a turn so arcs' ends bend into the head; then follow its curve a little.
    turn: [(y / ry) * 35, 180 - (x / rx) * 45, 0],
  };
}

/** The base a config names, or the first one for an id this client doesn't know. */
function baseFor(config: KeeperConfig, data: KeeperData, missing: string[]): KeeperBase {
  const base = data.bases.find((b) => b.id === config.base);
  if (base) return base;
  missing.push(config.base);
  const fallback = data.bases[0];
  if (!fallback) throw new Error('keeperParams: no Keeper bases');
  return fallback;
}

function colorFor(
  rows: readonly { id: string; color: string }[],
  id: string,
  fallback: string,
  missing: string[],
): Rgb {
  const row = rows.find((r) => r.id === id) ?? rows.find((r) => r.id === fallback);
  if (!rows.some((r) => r.id === id)) missing.push(id);
  return hexToRgb(row?.color ?? KEEPER.colors.ink);
}

/** Everything that draws `config`, wearing `items` (at most one per slot; later ones win). */
export function keeperParams(
  config: KeeperConfig,
  data: KeeperData,
  items: readonly KeeperItem[] = [],
): KeeperParams {
  const missing: string[] = [];
  const base = baseFor(config, data, missing);
  const hair = colorFor(data.hairColors, config.hairColor, base.hairColor, missing);
  const eye = colorFor(data.eyeColors, config.eyeColor, base.eyeColor, missing);
  const outfit =
    data.outfits.find((o) => o.id === config.outfit) ??
    data.outfits.find((o) => o.id === base.outfit);
  if (!data.outfits.some((o) => o.id === config.outfit)) missing.push(config.outfit);
  if (!outfit) throw new Error('keeperParams: no outfits');
  const top = hexToRgb(outfit.top);
  const bottom = hexToRgb(outfit.bottom);
  const shoes = hexToRgb(outfit.shoes);
  const trim = hexToRgb(outfit.trim);
  const skin = hexToRgb(base.skin);
  const ink = hexToRgb(KEEPER.colors.ink);
  const white = hexToRgb(KEEPER.colors.white);

  // Seeded by the whole config, so the same config is always the same Keeper.
  const rng = Rng.fromSeed(
    deriveSeed('keeper', base.id, config.hairColor, config.eyeColor, config.outfit),
  );

  const b = base.body;
  const s = KEEPER.height * b.height;
  const t = b.limbs * s;
  const tw = b.torsoWidth * s;
  const th = b.torsoHeight * s;
  const round = b.roundness;
  const torso: Vec3 = [
    tw * (1 + 0.15 * round),
    th * (1.05 + 0.1 * round),
    tw * KEEPER.torsoDepth * (1 + 0.15 * round),
  ];
  const shoe: Vec3 = [t * KEEPER.shoe[0], t * KEEPER.shoe[1], t * KEEPER.shoe[2]];
  const hipY = b.legs * s + shoe[1] * 0.5;
  const torsoY = hipY + th / 2;
  const legX = tw * 0.24;
  const d = b.head * s;
  const head: Head = {
    c: [0, hipY + th + d * (0.5 - KEEPER.neckSink), 0],
    r: [(d * b.headShape) / 2, d / 2, (d * 0.95) / 2],
  };

  const pieces: KeeperPiece[] = [];
  const piece = (
    layer: KeeperLayer,
    shape: PartShape,
    at: Vec3,
    size: Vec3,
    color: Rgb,
    turn: Vec3 = NO_TURN,
  ) => {
    pieces.push({ shape, at, size, turn, color, layer });
  };

  // ── Body and starter outfit ───────────────────────────────────────────
  for (const side of [-1, 1]) {
    const x = side * legX;
    piece('outfit', 'ellipsoid', [x, shoe[1] / 2, -t * 0.3], shoe, shoes);
    const legBottom = shoe[1] * 0.6;
    const legTop = hipY + th * 0.15;
    piece('body', 'capsule', [x, (legBottom + legTop) / 2, 0], [t, legTop - legBottom, t], skin);
    // Shorts legs, so the bottom reads as clothing.
    piece('outfit', 'capsule', [x, hipY - t * 0.35, 0], [t * 1.3, t * 1.4, t * 1.3], bottom);
  }
  piece('outfit', round >= 0.6 ? 'ellipsoid' : 'capsule', [0, torsoY, 0], torso, top);
  const shorts: Vec3 = [torso[0] * 1.04, th * 0.5, torso[2] * 1.04];
  piece('outfit', 'ellipsoid', [0, hipY + th * 0.1, 0], shorts, bottom);
  piece(
    'outfit',
    'ellipsoid',
    [0, hipY + th * 0.95, 0],
    [tw * 0.62, th * 0.18, torso[2] * 0.72],
    trim,
  );
  const front = -torso[2] / 2;
  for (const y of [0.62, 0.38]) {
    piece(
      'outfit',
      'ellipsoid',
      [0, hipY + th * y, front + t * 0.05],
      [t * 0.36, t * 0.36, t * 0.2],
      trim,
    );
  }

  // Arms hang down and a little out (sin and cos of KEEPER.armSplayDeg).
  const armLength = b.arms * s;
  const out = 0.2419; // sin 14°
  const down = 0.9703; // cos 14°
  const hands: Vec3[] = [];
  for (const side of [-1, 1]) {
    const shoulder: Vec3 = [side * (torso[0] / 2 - t * 0.15), hipY + th * 0.82, 0];
    const along = (k: number): Vec3 =>
      add(shoulder, [side * out * armLength * k, -down * armLength * k, 0]);
    const roll = -side * KEEPER.armSplayDeg;
    piece('body', 'capsule', along(0.5), [t * 0.95, armLength, t * 0.95], skin, [0, 0, roll]);
    const sleeve = KEEPER.sleeve;
    piece('outfit', 'capsule', along(sleeve / 2), [t * 1.3, armLength * sleeve, t * 1.3], top, [
      0,
      0,
      roll,
    ]);
    const hand = along(1 + t / armLength / 4);
    hands.push(hand);
    piece('body', 'ellipsoid', hand, [t * KEEPER.hand, t * KEEPER.hand, t * KEEPER.hand], skin);
  }

  // ── Head and face ─────────────────────────────────────────────────────
  piece('body', 'ellipsoid', head.c, [head.r[0] * 2, head.r[1] * 2, head.r[2] * 2], skin);
  const f = KEEPER.face;
  const feature = (
    shape: PartShape,
    fx: number,
    fy: number,
    size: Vec3,
    color: Rgb,
    roll = 0,
  ): Vec3 => {
    const p = facePoint(head, fx, fy, size[2]);
    piece('face', shape, p.at, size, color, [p.turn[0], p.turn[1], p.turn[2] + roll]);
    return p.at;
  };
  for (const side of [-1, 1]) {
    const ex = side * f.eyeSpread;
    switch (base.face.eyes) {
      case 'round':
      case 'oval': {
        const size: Vec3 =
          base.face.eyes === 'round'
            ? [0.15 * d, 0.17 * d, 0.07 * d]
            : [0.11 * d, 0.2 * d, 0.07 * d];
        const at = feature('ellipsoid', ex, f.eyeHeight, size, eye);
        // A glossy glint, up and to the right on both eyes.
        piece(
          'face',
          'ellipsoid',
          add(at, [size[0] * 0.22, size[1] * 0.22, -size[2] * 0.4]),
          [size[0] * 0.38, size[0] * 0.38, size[2] * 0.4],
          white,
        );
        break;
      }
      case 'happy':
        // Closed, smiling eyes: an arc upside down (∩).
        feature('arc', ex, f.eyeHeight, [0.16 * d, 0.075 * d, 0.05 * d], eye, 180);
        break;
      case 'sleepy':
        feature('arc', ex, f.eyeHeight - 0.01, [0.17 * d, 0.06 * d, 0.05 * d], eye);
        break;
    }
    if (base.face.brows) {
      feature('capsule', ex, f.browHeight, [0.03 * d, 0.12 * d, 0.03 * d], hair, 90 - side * 10);
    }
    feature(
      'ellipsoid',
      side * f.cheekSpread,
      f.cheekHeight,
      [0.15 * d, 0.08 * d, 0.035 * d],
      hexToRgb(KEEPER.colors.blush),
    );
    if (base.face.freckles) {
      for (let i = 0; i < KEEPER.freckles.count; i++) {
        const spread = KEEPER.freckles.spread;
        feature(
          'ellipsoid',
          side * f.cheekSpread + wobble(rng, spread),
          f.cheekHeight + 0.05 + wobble(rng, spread * 0.5),
          [0.024 * d, 0.024 * d, 0.012 * d],
          hexToRgb(KEEPER.colors.freckle),
        );
      }
    }
  }
  switch (base.face.mouth) {
    case 'smile':
      feature('arc', 0, f.mouthHeight, [0.17 * d, 0.075 * d, 0.05 * d], ink);
      break;
    case 'grin':
      feature(
        'ellipsoid',
        0,
        f.mouthHeight,
        [0.14 * d, 0.1 * d, 0.05 * d],
        hexToRgb(KEEPER.colors.mouth),
      );
      break;
    case 'tiny':
      feature('arc', 0, f.mouthHeight, [0.09 * d, 0.045 * d, 0.045 * d], ink);
      break;
    case 'cat':
      for (const side of [-1, 1]) {
        feature('arc', side * 0.04, f.mouthHeight, [0.08 * d, 0.045 * d, 0.04 * d], ink);
      }
      break;
  }

  // ── Hair ──────────────────────────────────────────────────────────────
  const j = KEEPER.jitter;
  for (const [shape, at, size, turn = NO_TURN] of HAIRSTYLES[base.hairstyle]) {
    const k = 1 + wobble(rng, j.hairSize);
    piece(
      'hair',
      shape,
      onHead(head, at[0], at[1], at[2]),
      headSized(head, size[0] * k, size[1] * k, size[2] * k),
      hair,
      [turn[0], turn[1], turn[2] + wobble(rng, j.hairDeg)],
    );
  }

  // ── Sockets ───────────────────────────────────────────────────────────
  const volume = HAIR_VOLUME[base.hairstyle];
  const hairTop = head.c[1] + volume.top * head.r[1];
  const headWidth = 2 * head.r[0] * volume.width;
  const heldSize = s * 0.32;
  const footprint = Math.max(torso[0], headWidth);
  const sockets: Record<WardrobeSlot, KeeperSocket> = {
    hat: {
      slot: 'hat',
      anchors: [[0, hairTop - head.r[1] * 0.2, head.r[2] * 0.08]],
      size: [headWidth, 2 * head.r[1], 2 * head.r[2] * volume.width],
    },
    'hair-accessory': {
      slot: 'hair-accessory',
      anchors: [onHead(head, 0.78 * volume.width, 0.62, -0.05)],
      size: [d * 0.36, d * 0.36, d * 0.36],
    },
    top: { slot: 'top', anchors: [[0, torsoY, 0]], size: torso },
    bottom: { slot: 'bottom', anchors: [[0, hipY + th * 0.1, 0]], size: shorts },
    shoes: {
      slot: 'shoes',
      anchors: [-1, 1].map((side): Vec3 => [side * legX, shoe[1] / 2, -t * 0.3]),
      size: shoe,
    },
    back: { slot: 'back', anchors: [[0, torsoY + th * 0.1, 0]], size: torso },
    held: {
      slot: 'held',
      anchors: [hands[1] ?? [0, 0, 0]],
      size: [heldSize, heldSize, heldSize],
    },
    costume: {
      slot: 'costume',
      anchors: [[0, hairTop / 2, 0]],
      size: [footprint * 1.05, hairTop, Math.max(torso[2], 2 * head.r[2]) * 1.1],
    },
  };

  // ── Clothing ──────────────────────────────────────────────────────────
  const bySlot = new Map<WardrobeSlot, KeeperItem>();
  for (const item of items) bySlot.set(item.slot, item);
  const costume = bySlot.get('costume');
  const worn = costume ? [costume] : WARDROBE_SLOTS.flatMap((slot) => bySlot.get(slot) ?? []);
  for (const item of worn) {
    const socket = sockets[item.slot];
    socket.anchors.forEach((anchor, i) => {
      // The first of two anchors is the left one: mirror the item onto it.
      const mirror = socket.anchors.length === 2 && i === 0 ? -1 : 1;
      for (const p of item.pieces) {
        const offset = times(p.at, socket.size);
        const turn = p.turn ?? NO_TURN;
        piece(
          item.slot,
          p.shape,
          add(anchor, [offset[0] * mirror, offset[1], offset[2]]),
          times(p.size, socket.size),
          hexToRgb(p.color),
          [turn[0], turn[1] * mirror, turn[2] * mirror],
        );
      }
    });
  }

  return {
    config,
    height: hairTop,
    width: footprint,
    // Hair tucks under a costume's hood rather than poking through it.
    pieces: costume ? pieces.filter((p) => p.layer !== 'hair') : pieces,
    sockets,
    worn: worn.map((item) => item.id),
    missing,
  };
}

/** A stable fingerprint (tests and the dev hook compare these, not pixels). */
export function keeperHash(params: KeeperParams): string {
  return hashString(JSON.stringify(params));
}
